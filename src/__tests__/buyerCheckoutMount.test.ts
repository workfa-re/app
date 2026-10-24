import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stripe, StripeEmbeddedCheckout, StripeEmbeddedCheckoutOptions } from "@stripe/stripe-js";
import { mountBuyerCheckout } from "@/components/payments/buyer-checkout-mount";

const deferred = <T,>() => {
    let resolve!: (value:T)=>void;let reject!: (error:unknown)=>void;
    const promise=new Promise<T>((accept,refuse)=>{resolve=accept;reject=refuse;});return {promise,resolve,reject};
};
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
function setup() {
    const checkout={mount:vi.fn(),destroy:vi.fn(),unmount:vi.fn()};
    const create=vi.fn().mockResolvedValue(checkout);
    const stripe={createEmbeddedCheckoutPage:create} as unknown as Stripe;
    const input={load:vi.fn().mockResolvedValue(stripe),target:{} as HTMLElement,clientSecret:"cs_test_fixture_secret_private",onComplete:vi.fn(),onReady:vi.fn(),onError:vi.fn(),timeoutMs:1000};
    return {input,checkout,create,stripe};
}
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>vi.useRealTimers());
describe("recoverable embedded buyer initialization",()=>{
    it("mounts only the Stripe-owned element and completes at most once",async()=>{
        const {input,checkout,create}=setup();const dispose=mountBuyerCheckout(input);await flush();
        expect(checkout.mount).toHaveBeenCalledExactlyOnceWith(input.target);expect(input.onReady).toHaveBeenCalledOnce();
        const options=create.mock.calls[0][0] as StripeEmbeddedCheckoutOptions;
        expect(options.clientSecret).toBe(input.clientSecret);options.onComplete?.();options.onComplete?.();expect(input.onComplete).toHaveBeenCalledOnce();
        dispose();dispose();expect(checkout.destroy).toHaveBeenCalledOnce();
        options.onComplete?.();expect(input.onComplete).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
    });
    it.each([null,new Error("provider returned a secret and customer contact")])("contains missing Stripe and loader failures without exposing the exception",async failure=>{
        const {input}=setup();if(failure)input.load.mockRejectedValue(failure);else input.load.mockResolvedValue(null);
        const dispose=mountBuyerCheckout(input);await flush();
        expect(input.onError).toHaveBeenCalledExactlyOnceWith();expect(input.onReady).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);dispose();
    });
    it("contains an initialization rejection instead of creating an unhandled promise",async()=>{
        const {input,create}=setup();create.mockRejectedValue(new Error("invalid client secret contains confidential data"));
        const dispose=mountBuyerCheckout(input);await flush();expect(input.onError).toHaveBeenCalledExactlyOnceWith();expect(input.onReady).not.toHaveBeenCalled();dispose();
    });
    it("safely destroys an instance when mount throws",async()=>{
        const {input,checkout}=setup();checkout.mount.mockImplementation(()=>{throw new Error("blocked frame")});
        const dispose=mountBuyerCheckout(input);await flush();expect(checkout.destroy).toHaveBeenCalledOnce();expect(input.onError).toHaveBeenCalledOnce();dispose();expect(checkout.destroy).toHaveBeenCalledOnce();
    });
    it("does not initialize Stripe after the form was closed during loader startup",async()=>{
        const {input,create,stripe}=setup();const waiting=deferred<Stripe>();input.load.mockReturnValue(waiting.promise);
        const dispose=mountBuyerCheckout(input);dispose();waiting.resolve(stripe);await flush();
        expect(create).not.toHaveBeenCalled();expect(input.onReady).not.toHaveBeenCalled();expect(input.onError).not.toHaveBeenCalled();
    });
    it("destroys a late successful initialization after navigation without mounting it",async()=>{
        const {input,checkout,create}=setup();const waiting=deferred<StripeEmbeddedCheckout>();create.mockReturnValue(waiting.promise);
        const dispose=mountBuyerCheckout(input);await flush();dispose();waiting.resolve(checkout);await flush();
        expect(checkout.destroy).toHaveBeenCalledOnce();expect(checkout.mount).not.toHaveBeenCalled();expect(input.onReady).not.toHaveBeenCalled();
    });
    it("bounds a stalled CSP/network attempt and does not revive its stale frame later",async()=>{
        const {input,checkout,create}=setup();const waiting=deferred<StripeEmbeddedCheckout>();create.mockReturnValue(waiting.promise);
        const dispose=mountBuyerCheckout(input);await flush();await vi.advanceTimersByTimeAsync(1001);
        expect(input.onError).toHaveBeenCalledOnce();waiting.resolve(checkout);await flush();
        expect(checkout.destroy).toHaveBeenCalledOnce();expect(checkout.mount).not.toHaveBeenCalled();expect(input.onReady).not.toHaveBeenCalled();dispose();
    });
    it("can retry the same owner session after a failed attempt, without creating a payment",async()=>{
        const first=setup();first.input.load.mockRejectedValue(new Error("offline"));const stopFirst=mountBuyerCheckout(first.input);await flush();stopFirst();
        const retry=setup();const stopRetry=mountBuyerCheckout(retry.input);await flush();
        expect(retry.input.onReady).toHaveBeenCalledOnce();expect(retry.create.mock.calls[0][0].clientSecret).toBe(first.input.clientSecret);
        expect(Object.keys(retry.stripe)).toEqual(["createEmbeddedCheckoutPage"]);stopRetry();
    });
});
