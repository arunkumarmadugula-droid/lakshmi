import { useMemo, useState } from "react";
import { CATEGORIES } from "../data/defaults.js";
import { priceComparisons } from "../lib/finance.js";
import { money } from "../lib/format.js";
import { Button, Card, CardHeader, EmptyState, Icon } from "../components/ui.jsx";

export default function PricesTab({ vault }) {
  const [category, setCategory] = useState("All");
  const comparisons = useMemo(() => priceComparisons(vault, category), [vault, category]);
  const availableCategories = useMemo(() => ["All", ...CATEGORIES.filter((name) => vault.expenses.some((expense) => expense.category === name && expense.items?.length))], [vault.expenses]);
  return (
    <>
      <div className="chip-row" aria-label="Price category">
        {availableCategories.map((value) => <Button key={value} kind={category === value ? "primary" : ""} compact onClick={() => setCategory(value)}>{value}</Button>)}
      </div>
      {comparisons.length ? comparisons.map((item) => (
        <Card key={`${item.name}-${item.unit}`}>
          <CardHeader label={item.category || "Price comparison"} title={item.name} helper={`Comparable price per ${item.unit}`} action={<span className="status-pill good">Save {money(item.savings)}</span>} />
          {item.stores.map((store, index) => (
            <div className="row with-icon" key={store.store}>
              <span className="icon-box" style={{ color: index === 0 ? "var(--inflow)" : undefined }}><Icon name={index === 0 ? "check" : "prices"} /></span>
              <span><strong>{store.store}</strong><br /><span className="helper">Last seen {store.date}</span></span>
              <strong className={`money ${index === 0 ? "text-in" : ""}`}>{money(store.price)} / {item.unit}</strong>
            </div>
          ))}
        </Card>
      )) : (
        <Card><EmptyState icon="prices" title="Price comparisons appear automatically" helper="Save itemized receipts from two stores for the same product and unit." /></Card>
      )}
    </>
  );
}
