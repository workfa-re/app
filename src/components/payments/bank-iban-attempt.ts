import type { Stripe, StripeIbanElement } from "@stripe/stripe-js";
import { PaymentRequestError } from "./payment-client";
import { PAYMENT_OWNER_CHANGED } from "./usePaymentOwner";

const TOKEN = /^btok_[a-zA-Z0-9]{1,195}$/;

/** A token survives an uncertain response only in this mounted owner's memory. */
export class InitialBankAttempt {
    private token: string | null = null;
    private disposed = false;
    private pending = false;

    get hasToken() { return this.token !== null; }
    dispose() { this.disposed = true; this.token = null; }

    async save(input: {
        stripe: Pick<Stripe, "createToken">;
        iban: StripeIbanElement;
        holderName: string;
        isCurrentOwner: () => boolean;
        onSave: (token: string) => Promise<void>;
    }) {
        const current = () => !this.disposed && input.isCurrentOwner();
        const assertCurrent = () => {
            if (!current()) {
                this.dispose();
                throw new PaymentRequestError(PAYMENT_OWNER_CHANGED, "owner_mismatch");
            }
        };
        assertCurrent();
        if (this.pending) return;
        this.pending = true;
        try {
            if (!this.token) {
                const name = input.holderName.trim();
                if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) {
                    throw new PaymentRequestError("Bitte gib den Namen der Person an, der das Bankkonto gehört.", "invalid_holder_name");
                }
                const result = await input.stripe.createToken(input.iban, { currency: "eur", account_holder_name: name, account_holder_type: "individual" });
                assertCurrent();
                if (result.error) throw new PaymentRequestError(result.error.message || "Bitte prüfe deine Bankverbindung.", "invalid_bank_details");
                if (!result.token || !TOKEN.test(result.token.id) || result.token.type !== "bank_account" || result.token.livemode !== true
                    || result.token.bank_account?.currency !== "eur") {
                    throw new PaymentRequestError("Die Bankverbindung konnte nicht bestätigt werden. Bitte lade den Bereich erneut.", "invalid_bank_token");
                }
                this.token = result.token.id;
            }
            assertCurrent();
            try { await input.onSave(this.token); }
            catch (error) {
                // Only a confirmed rejection before the bank write allows a new token.
                if (error instanceof PaymentRequestError && error.code === "recipient_bank_token_invalid") this.token = null;
                throw error;
            }
            assertCurrent();
            this.token = null;
        } finally { this.pending = false; }
    }
}
