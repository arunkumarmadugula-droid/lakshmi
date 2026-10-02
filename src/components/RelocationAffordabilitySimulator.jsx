import { useState } from "react";
import { money, number } from "../lib/format.js";
import { Button, Card, CardHeader, Icon } from "./ui.jsx";

function RangeControl({ label, value, min, max, step, display, onChange }) {
  return (
    <label className="range-control">
      <span><span>{label}</span><strong>{display(value)}</strong></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(number(event.target.value))} />
    </label>
  );
}

export default function RelocationAffordabilitySimulator({ config, vehicle, onSave }) {
  const [scenario, setScenario] = useState(config);
  const update = (key, value) => setScenario((current) => ({ ...current, [key]: value }));
  const economy = number(vehicle?.combinedRating) || 10;
  const kilometresAvoided = number(scenario.avoidedTrips) * number(scenario.roundTripKm);
  const avoidedFuel = Math.min(number(scenario.currentFuelBudget), kilometresAvoided * economy / 100 * number(scenario.fuelPrice));
  const avoidedWear = kilometresAvoided * number(scenario.vehicleWearPerKm);
  const rentDifference = number(scenario.candidateShelter) - number(scenario.currentShelter);
  const netVariance = rentDifference + number(scenario.candidateTransitCost) - avoidedFuel - avoidedWear;
  const currentCashCost = number(scenario.currentShelter) + number(scenario.currentFuelBudget);
  const candidateCashCost = number(scenario.candidateShelter) + number(scenario.candidateTransitCost) + Math.max(0, number(scenario.currentFuelBudget) - avoidedFuel);

  return (
    <Card className="planning-card relocation-card">
      <CardHeader label="Relocation affordability" title="Housing + commute matrix" helper="Rent differences are tested against avoided station trips, fuel, and vehicle wear" />
      <div className="scenario-compare">
        <div className="scenario-column"><div className="label">Current</div><strong>{scenario.currentAddress}</strong><span>{money(scenario.currentShelter, 0)} shelter</span><span>{money(scenario.currentFuelBudget, 0)} fuel</span><b>{money(currentCashCost, 0)}/mo</b></div>
        <div className="scenario-column candidate"><div className="label">Candidate</div><strong>{scenario.candidateAddress}</strong><span>{money(scenario.candidateShelter, 0)} shelter</span><span>{money(scenario.candidateTransitCost, 0)} transit</span><b>{money(candidateCashCost, 0)}/mo</b></div>
      </div>
      <div className={`variance-banner ${netVariance <= 0 ? "positive" : "negative"}`}><span>{netVariance <= 0 ? "Estimated monthly saving" : "Estimated monthly premium"}</span><strong>{money(Math.abs(netVariance))}</strong></div>
      <div className="slider-stack">
        <RangeControl label="Current shelter" value={scenario.currentShelter} min="1500" max="3500" step="50" display={(value) => money(value, 0)} onChange={(value) => update("currentShelter", value)} />
        <RangeControl label="Candidate shelter" value={scenario.candidateShelter} min="1500" max="3500" step="50" display={(value) => money(value, 0)} onChange={(value) => update("candidateShelter", value)} />
        <RangeControl label="Morning trips avoided" value={scenario.avoidedTrips} min="0" max="22" step="1" display={(value) => `${value} / month`} onChange={(value) => update("avoidedTrips", value)} />
        <RangeControl label="Fuel price" value={scenario.fuelPrice} min="1.4" max="2" step="0.05" display={(value) => `$${number(value).toFixed(2)}/L`} onChange={(value) => update("fuelPrice", value)} />
      </div>
      <details className="settings-section scenario-drawer"><summary><span><Icon name="car" />Commute assumptions</span><Icon name="chevron-down" /></summary><div className="settings-section-body"><div className="row"><span>Round trip</span><strong>{number(scenario.roundTripKm)} km</strong></div><div className="row"><span>Vehicle efficiency</span><strong>{economy.toFixed(1)} L/100 km</strong></div><div className="row"><span>Fuel avoided</span><strong className="text-in">{money(avoidedFuel)}</strong></div><div className="row"><span>Wear avoided</span><strong className="text-in">{money(avoidedWear)}</strong></div><div className="privacy-note">Vehicle wear is a planning allowance of {money(scenario.vehicleWearPerKm)}/km, not a cash transaction.</div></div></details>
      <Button compact onClick={() => onSave(scenario)}><Icon name="save" />Save scenario</Button>
    </Card>
  );
}
