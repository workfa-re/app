"use client";

import { useId, useState } from "react";
import { Pencil } from "lucide-react";
import { LocationAutocomplete } from "@/components/ui/LocationAutocomplete";
import { ButtonPrimary } from "@/components/ui/ButtonPrimary";
import { OnboardingHeading } from "./OnboardingFrame";
import { getProviderOnboardingAddressError, type ProviderOnboardingAddress } from "@/lib/onboarding-validation";

export function ProviderAddressStep({ initialAddress, company = false, onComplete }: {
  initialAddress: ProviderOnboardingAddress | null;
  company?: boolean;
  onComplete: (address: ProviderOnboardingAddress) => void;
}) {
  const fieldId = useId();
  const [address, setAddress] = useState(initialAddress);
  const [searching, setSearching] = useState(!initialAddress);
  const [needsHouseNumber, setNeedsHouseNumber] = useState(Boolean(initialAddress && !initialAddress.houseNumber));
  const [error, setError] = useState<string | null>(null);
  return <section className="onboarding-step-panel">
    <OnboardingHeading title={company ? "Deine Geschäftsadresse" : "Deine Adresse"}
      subtitle="Einmal hinterlegen. Danach kannst du deinen ersten Job vorbereiten." />
    <form className="onboarding-details-form" onSubmit={event => {
      event.preventDefault();
      const nextError = getProviderOnboardingAddressError(address);
      setError(nextError);
      if (!nextError && address) onComplete(address);
    }}>
      <div className="onboarding-field">
        <label htmlFor={fieldId}>{company ? "Geschäftsadresse" : "Wohnadresse"}</label>
        {searching ? <LocationAutocomplete inputId={fieldId} placeholder="Straße, Hausnummer und Ort" autoFocus
          onInputChange={() => { setAddress(null); setError(null); }}
          onSelect={location => {
            setAddress({ street: location.address_line1, houseNumber: location.house_number || "", city: location.city,
              zip: location.postal_code, latitude: location.lat, longitude: location.lng });
            setSearching(false); setError(null);
            setNeedsHouseNumber(!location.house_number);
          }} /> : address && <div className="onboarding-address-selection">
            <div><strong>{address.street} {address.houseNumber}</strong><span>{address.zip} {address.city}</span></div>
            <button type="button" className="onboarding-icon-button" aria-label="Andere Adresse suchen" onClick={() => { setSearching(true); setError(null); }}><Pencil size={18} aria-hidden="true" /></button>
          </div>}
        <p className="onboarding-field-hint">Deine genaue Adresse bleibt privat. Den Einsatzort bestimmst du bei jedem Job.</p>
      </div>
      {!searching && address && needsHouseNumber && <div className="onboarding-field">
        <label htmlFor={`${fieldId}-house`}>Hausnummer</label>
        <input id={`${fieldId}-house`} autoComplete="address-line2" value={address.houseNumber} required maxLength={24}
          onChange={event => { setAddress({ ...address, houseNumber: event.target.value }); setError(null); }} />
      </div>}
      {error && <p className="onboarding-location-error" role="alert">{error}</p>}
      <div className="onboarding-details-actions"><ButtonPrimary type="submit" className="w-full" disabled={!address || searching}>Weiter</ButtonPrimary></div>
    </form>
  </section>;
}
