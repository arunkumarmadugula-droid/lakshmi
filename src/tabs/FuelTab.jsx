import { useEffect, useMemo, useState } from "react";
import { fuelMetrics } from "../lib/finance.js";
import { money, number, todayISO, uid } from "../lib/format.js";
import { Button, Card, CardHeader, EmptyState, Field, Icon, IconButton, Input, Modal, Select } from "../components/ui.jsx";

export default function FuelTab({ vault, persist, notify, openModal }) {
  const vehicle = vault.vehicles.find((item) => item.active !== false) || vault.vehicles[0];
  const metrics = useMemo(() => fuelMetrics(vault, vehicle?.id), [vault, vehicle?.id]);
  const [fillOpen, setFillOpen] = useState(false);
  const [tripDistance, setTripDistance] = useState("");
  const [tripPrice, setTripPrice] = useState("");
  const consumption = metrics.average || number(vehicle?.combinedRating);
  const tripLitres = consumption ? number(tripDistance) * consumption / 100 : 0;
  const tripCost = tripLitres * number(tripPrice);
  const range = consumption && number(vehicle?.tankCapacity) ? number(vehicle.tankCapacity) / consumption * 100 : 0;

  function removeFill(entry) {
    if (!window.confirm(`Delete fill-up from ${entry.date}?`)) return;
    const expense = vault.expenses.find((item) => item.id === entry.sourceExpenseId);
    persist({
      ...vault,
      fuelEntries: vault.fuelEntries.filter((item) => item.id !== entry.id),
      expenses: expense ? vault.expenses.filter((item) => item.id !== expense.id) : vault.expenses,
      settings: expense && expense.paymentMethod !== "credit" ? { ...vault.settings, bankBalance: number(vault.settings.bankBalance) + number(expense.total) } : vault.settings,
    });
    notify("Fill-up removed and linked expense reconciled.");
  }

  if (!vehicle) {
    return (
      <Card>
        <EmptyState icon="car" title="Add your vehicle" helper="Choose an offline Canadian fuel rating, then add tank capacity and current odometer." action={<Button kind="primary" onClick={() => openModal({ content: <VehicleModal vault={vault} persist={persist} notify={notify} onClose={() => openModal(null)} /> })}><Icon name="plus" />Add vehicle</Button>} />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader label="Current vehicle" title={`${vehicle.year} ${vehicle.make} ${vehicle.model}`} helper={`NRCan combined rating ${vehicle.combinedRating ? `${vehicle.combinedRating} L/100 km` : "not selected"}`} action={<Button compact onClick={() => openModal({ content: <VehicleModal vault={vault} vehicle={vehicle} persist={persist} notify={notify} onClose={() => openModal(null)} /> })}><Icon name="edit" />Edit</Button>} />
        <div className="metric-grid">
          <div className="metric-tile"><div className="label">Average</div><div className="metric-value">{metrics.average ? metrics.average.toFixed(1) : "--"}</div><div className="helper">L/100 km</div></div>
          <div className="metric-tile"><div className="label">Tracked</div><div className="metric-value">{Math.round(metrics.kmTracked)}</div><div className="helper">km</div></div>
          <div className="metric-tile"><div className="label">Range</div><div className="metric-value">{range ? Math.round(range) : "--"}</div><div className="helper">estimated km</div></div>
        </div>
      </Card>

      <Card>
        <CardHeader label="Fill-ups" helper="Odometer, litres, station, and octane" action={<Button compact onClick={() => setFillOpen((value) => !value)}><Icon name={fillOpen ? "x" : "plus"} />{fillOpen ? "Close" : "Log fill-up"}</Button>} noMargin={!fillOpen} />
        {fillOpen && <FillForm vehicle={vehicle} vault={vault} persist={persist} notify={notify} onSaved={() => setFillOpen(false)} />}
      </Card>

      <Card>
        <CardHeader label="Smart summary" helper="Calculated from full-tank odometer intervals" />
        <div className="row"><span>Best station / fuel</span><strong>{metrics.bestStation?.name || "Not enough data"}</strong></div>
        <div className="row"><span>Observed fuel economy</span><strong className="money">{metrics.average ? `${metrics.average.toFixed(1)} L/100 km` : "--"}</strong></div>
        <div className="row"><span>Cost per 100 km</span><strong className="money">{metrics.costPer100 ? money(metrics.costPer100) : "--"}</strong></div>
        <div className="row"><span>Official combined rating</span><strong className="money">{vehicle.combinedRating ? `${vehicle.combinedRating} L/100 km` : "--"}</strong></div>
      </Card>

      <Card>
        <CardHeader label="Trip estimator" helper="Uses observed economy first, then the offline NRCan rating" />
        <div className="field-grid"><Field label="Distance km"><Input inputMode="decimal" value={tripDistance} onChange={(event) => setTripDistance(event.target.value)} /></Field><Field label="Fuel price / L"><Input inputMode="decimal" value={tripPrice} onChange={(event) => setTripPrice(event.target.value)} /></Field></div>
        <div className="row"><span>Estimated fuel</span><strong className="money">{tripLitres ? `${tripLitres.toFixed(1)} L` : "--"}</strong></div>
        <div className="row"><span>Estimated cost</span><strong className="money">{tripCost ? money(tripCost) : "--"}</strong></div>
      </Card>

      <Card>
        <CardHeader label="Fuel history" helper={`${metrics.entries.length} fill-up${metrics.entries.length === 1 ? "" : "s"}`} />
        {metrics.entries.length ? [...metrics.entries].reverse().map((entry) => {
          const trip = metrics.trips.find((item) => item.id === entry.id);
          return <div className="row with-icon" key={entry.id}><span className="icon-box"><Icon name="fuel" /></span><span className="truncate"><strong>{entry.station || "Fuel"}</strong><br /><span className="helper">{entry.date} - {entry.octane || "Regular"} - {number(entry.odometer).toLocaleString("en-CA")} km</span></span><span className="row-actions"><strong className="money">{trip ? `${trip.economy.toFixed(1)} L/100` : money(entry.cost)}</strong><IconButton icon="trash" label="Delete fill-up" className="danger" onClick={() => removeFill(entry)} /></span></div>;
        }) : <div className="helper">Add two full-tank fill-ups to calculate observed fuel economy.</div>}
      </Card>
    </>
  );
}

function VehicleModal({ vault, vehicle, persist, notify, onClose }) {
  const [vehicleRatings, setVehicleRatings] = useState([]);
  const [catalogueError, setCatalogueError] = useState("");
  const years = useMemo(() => [...new Set(vehicleRatings.map((item) => item.y))].sort((a, b) => b - a), [vehicleRatings]);
  const [form, setForm] = useState(vehicle || { id: uid("vehicle"), year: 2026, make: "", model: "", odometer: "", tankCapacity: "", combinedRating: "", cityRating: "", highwayRating: "", fuelType: "", active: true });
  const makes = useMemo(() => [...new Set(vehicleRatings.filter((item) => item.y === number(form.year)).map((item) => item.m))].sort(), [vehicleRatings, form.year]);
  const models = useMemo(() => vehicleRatings.filter((item) => item.y === number(form.year) && item.m === form.make), [vehicleRatings, form.year, form.make]);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}vehicle-ratings-ca-2020-2026.json`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Catalogue unavailable")))
      .then(setVehicleRatings)
      .catch(() => setCatalogueError("Offline catalogue could not be loaded. Reopen Lakshmi once online to cache it."));
  }, []);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  function chooseYear(value) {
    setForm((current) => ({ ...current, year: number(value), make: "", model: "", combinedRating: "", cityRating: "", highwayRating: "", fuelType: "" }));
  }
  function chooseMake(value) {
    setForm((current) => ({ ...current, make: value, model: "", combinedRating: "", cityRating: "", highwayRating: "", fuelType: "" }));
  }
  function chooseModel(value) {
    const rating = models.find((item) => item.n === value);
    setForm((current) => ({ ...current, model: value, combinedRating: rating?.c || "", cityRating: rating?.ct || "", highwayRating: rating?.h || "", fuelType: rating?.f || "", vehicleClass: rating?.cl || "" }));
  }
  function save() {
    if (!form.make || !form.model) return;
    const item = { ...form, year: number(form.year), odometer: number(form.odometer), tankCapacity: number(form.tankCapacity), combinedRating: number(form.combinedRating), active: true };
    const exists = vault.vehicles.some((entry) => entry.id === item.id);
    const vehicles = exists ? vault.vehicles.map((entry) => entry.id === item.id ? item : { ...entry, active: false }) : [item, ...vault.vehicles.map((entry) => ({ ...entry, active: false }))];
    persist({ ...vault, vehicles });
    notify("Vehicle saved for offline fuel tracking.");
    onClose();
  }
  return (
    <Modal label="Vehicle setup" title={vehicle ? "Edit vehicle" : "Add vehicle"} onClose={onClose}>
      <div className="form-stack">
        {!vehicleRatings.length && !catalogueError && <div className="helper">Loading the offline Canadian vehicle catalogue...</div>}
        {catalogueError && <div className="error-text">{catalogueError}</div>}
        <div className="field-grid"><Field label="Model year"><Select value={form.year} onChange={(event) => chooseYear(event.target.value)}>{years.map((year) => <option key={year}>{year}</option>)}</Select></Field><Field label="Make"><Select value={form.make} onChange={(event) => chooseMake(event.target.value)}><option value="">Select</option>{makes.map((make) => <option key={make}>{make}</option>)}</Select></Field></div>
        <Field label="Model"><Select value={form.model} onChange={(event) => chooseModel(event.target.value)}><option value="">Select</option>{models.map((item) => <option key={`${item.n}-${item.c}`} value={item.n}>{item.n}</option>)}</Select></Field>
        <div className="field-grid"><Field label="Current odometer km"><Input inputMode="decimal" value={form.odometer ?? ""} onChange={(event) => update("odometer", event.target.value)} /></Field><Field label="Tank capacity L"><Input inputMode="decimal" value={form.tankCapacity ?? ""} onChange={(event) => update("tankCapacity", event.target.value)} placeholder="From owner manual" /></Field></div>
        <div className="security-banner"><span className="icon-box"><Icon name="database" /></span><div><strong>{form.combinedRating ? `${form.combinedRating} L/100 km combined` : "Choose a model"}</strong><div className="helper">Offline NRCan 2020-2026 rating{form.fuelType ? ` - fuel code ${form.fuelType}` : ""}. Tank capacity remains editable because it is not in the government dataset.</div></div></div>
        <Button kind="primary" disabled={!form.make || !form.model} onClick={save}><Icon name="save" />Save vehicle</Button>
      </div>
    </Modal>
  );
}

function FillForm({ vehicle, vault, persist, notify, onSaved }) {
  const last = vault.fuelEntries.filter((item) => item.vehicleId === vehicle.id).sort((a, b) => b.odometer - a.odometer)[0];
  const [form, setForm] = useState({ date: todayISO(), odometer: last?.odometer || vehicle.odometer || "", litres: "", cost: "", station: "", octane: "Regular", paymentMethod: "bank", cardId: "" });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  function save() {
    const litres = number(form.litres), cost = number(form.cost), odometer = number(form.odometer);
    if (litres <= 0 || cost <= 0 || odometer <= 0) return;
    if (last && odometer <= number(last.odometer)) { notify("Odometer must be higher than the previous fill-up."); return; }
    const expenseId = uid("expense");
    const entry = { id: uid("fuel"), vehicleId: vehicle.id, ...form, odometer, litres, cost, sourceExpenseId: expenseId };
    const expense = { id: expenseId, store: form.station.trim() || "Fuel", date: form.date, category: "Fuel", subtotal: cost, tax: 0, total: cost, items: [{ id: uid("item"), name: `${form.octane} fuel`, qty: litres, unit: "L", lineTotal: cost }], paymentMethod: form.paymentMethod, cardId: form.paymentMethod === "credit" ? form.cardId : "", source: "fuel", createdAt: new Date().toISOString() };
    persist({ ...vault, fuelEntries: [entry, ...vault.fuelEntries], expenses: [expense, ...vault.expenses], settings: form.paymentMethod === "credit" ? vault.settings : { ...vault.settings, bankBalance: number(vault.settings.bankBalance) - cost } });
    notify("Fill-up saved and added to Spent.");
    onSaved();
  }
  return (
    <div className="form-stack" style={{ marginTop: 10 }}>
      <div className="field-grid"><Field label="Date"><Input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} /></Field><Field label="Odometer km"><Input inputMode="decimal" value={form.odometer} onChange={(event) => update("odometer", event.target.value)} /></Field></div>
      <div className="field-grid"><Field label="Litres"><Input inputMode="decimal" value={form.litres} onChange={(event) => update("litres", event.target.value)} /></Field><Field label="Total cost"><Input inputMode="decimal" value={form.cost} onChange={(event) => update("cost", event.target.value)} /></Field></div>
      <div className="field-grid"><Field label="Station"><Input value={form.station} onChange={(event) => update("station", event.target.value)} /></Field><Field label="Octane"><Select value={form.octane} onChange={(event) => update("octane", event.target.value)}><option>Regular</option><option>Mid-grade</option><option>Premium</option><option>Diesel</option></Select></Field></div>
      <div className="field-grid"><Field label="Paid with"><Select value={form.paymentMethod} onChange={(event) => update("paymentMethod", event.target.value)}><option value="bank">Bank / debit</option><option value="cash">Cash</option><option value="credit">Credit card</option></Select></Field>{form.paymentMethod === "credit" ? <Field label="Card"><Select value={form.cardId} onChange={(event) => update("cardId", event.target.value)}><option value="">Unspecified</option>{vault.creditCards.map((card) => <option key={card.id} value={card.id}>{card.bank} {card.last4 ? `...${card.last4}` : card.name}</option>)}</Select></Field> : <div />}</div>
      <Button kind="primary" disabled={number(form.litres) <= 0 || number(form.cost) <= 0 || number(form.odometer) <= 0} onClick={save}><Icon name="save" />Save fill-up</Button>
    </div>
  );
}
