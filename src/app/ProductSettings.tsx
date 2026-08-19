"use client";

import { useEffect, useState } from "react";
import type {
  AmountUnit,
  MatchMode,
  ProductOverride,
  PurchaseStrategy,
  RestaurantProduct,
} from "@/domain/restaurant-product";
import {
  EGG_COUNT_PRESETS,
  isEggPackStaple,
} from "@/domain/egg-pack";
import { isPackSizeKeyword } from "@/domain/pack-tokens";

type Props = {
  product: RestaurantProduct;
  open: boolean;
  onClose: () => void;
  onSave: (
    override: ProductOverride,
    matchModeChanged: boolean,
    rematch: boolean,
  ) => void;
  storeOffers: Array<{
    retailer: string;
    label: string;
    productId?: string | null;
    name?: string | null;
  }>;
  confirmedStoreProducts?: Record<string, string>;
};

const UNITS: AmountUnit[] = ["g", "kg", "ml", "l", "ea", "pack"];

export function ProductSettings({
  product,
  open,
  onClose,
  onSave,
  storeOffers,
  confirmedStoreProducts,
}: Props) {
  const [matchMode, setMatchMode] = useState<MatchMode>(product.matchMode);
  const [purchaseStrategy, setPurchaseStrategy] = useState<PurchaseStrategy>(
    product.purchaseStrategy,
  );
  const [defaultAmount, setDefaultAmount] = useState(String(product.defaultAmount));
  const [unit, setUnit] = useState<AmountUnit>(product.unit);
  const [tolerancePercent, setTolerancePercent] = useState(
    String(product.tolerancePercent),
  );
  const [maximumAmount, setMaximumAmount] = useState(
    product.maximumAmount != null ? String(product.maximumAmount) : "",
  );
  const [productType, setProductType] = useState(product.matchRules?.productType ?? "");
  const [form, setForm] = useState(product.matchRules?.form ?? "");
  const [variant, setVariant] = useState(product.matchRules?.variant ?? "");
  const [include, setInclude] = useState(
    (product.matchRules?.mustIncludeAny ?? []).join(", "),
  );
  const [exclude, setExclude] = useState(
    (product.matchRules?.mustNotInclude ?? []).join(", "),
  );
  const [confirmed, setConfirmed] = useState<Record<string, string>>(
    confirmedStoreProducts ?? {},
  );

  useEffect(() => {
    if (!open) return;
    setMatchMode(product.matchMode);
    setPurchaseStrategy(product.purchaseStrategy);
    setDefaultAmount(String(product.defaultAmount));
    setUnit(product.unit);
    setTolerancePercent(String(product.tolerancePercent));
    setMaximumAmount(
      product.maximumAmount != null ? String(product.maximumAmount) : "",
    );
    setProductType(product.matchRules?.productType ?? "");
    setForm(product.matchRules?.form ?? "");
    setVariant(product.matchRules?.variant ?? "");
    setInclude((product.matchRules?.mustIncludeAny ?? []).join(", "));
    setExclude((product.matchRules?.mustNotInclude ?? []).join(", "));
    setConfirmed(confirmedStoreProducts ?? {});
  }, [open, product, confirmedStoreProducts]);

  if (!open) return null;

  function save(rematch: boolean) {
    const maxN = Number.parseFloat(maximumAmount);
    const override: ProductOverride = {
      matchMode,
      purchaseStrategy,
      defaultAmount: Number.parseFloat(defaultAmount) || product.defaultAmount,
      unit: isEggPackStaple(product) ? "ea" : unit,
      tolerancePercent: Number.parseFloat(tolerancePercent) || 15,
      matchRules: {
        productType: productType.trim() || undefined,
        form: form.trim() || undefined,
        variant: variant.trim() || undefined,
        mustIncludeAny: include
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && !isPackSizeKeyword(s)),
        mustNotInclude: exclude
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
      confirmedStoreProducts: confirmed,
    };
    if (purchaseStrategy === "stock_up" && Number.isFinite(maxN) && maxN > 0) {
      override.maximumAmount = maxN;
    }
    onSave(override, matchMode !== product.matchMode, rematch);
    onClose();
  }

  return (
    <div className="ps-back" role="dialog" aria-modal="true" aria-label="Налаштування">
      <div className="ps-panel">
        <header>
          <strong>{product.label}</strong>
          <button type="button" onClick={onClose}>
            Закрити
          </button>
        </header>
        <label>
          Правило пошуку
          <select
            value={matchMode}
            onChange={(e) => setMatchMode(e.target.value as MatchMode)}
          >
            <option value="exact">Точний продукт</option>
            <option value="cheapest_equivalent">Найдешевший відповідний</option>
          </select>
          <span className="ps-hint">
            Точний продукт тримає бренд і SKU. Розмір пачки (2.63L, 12oz, 1kg)
            не є обовʼязковим словом — магазини часто не пишуть його в назві.
            Include додає слова до фільтрів з каталогу, не замінює бренд.
            Найдешевший відповідний ігнорує бренд.
          </span>
        </label>
        <label>
          Стандартна кількість
          <input
            value={defaultAmount}
            onChange={(e) => setDefaultAmount(e.target.value)}
            inputMode="decimal"
          />
        </label>
        {isEggPackStaple(product) && (
          <div className="ps-eggs">
            <span>Пачки в яйцях</span>
            {EGG_COUNT_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                className={defaultAmount === String(n) ? "on" : ""}
                onClick={() => {
                  setDefaultAmount(String(n));
                  setUnit("ea");
                }}
              >
                {n}
              </button>
            ))}
          </div>
        )}
        <label>
          Одиниця
          <select
            value={isEggPackStaple(product) ? "ea" : unit}
            onChange={(e) => setUnit(e.target.value as AmountUnit)}
            disabled={isEggPackStaple(product)}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {isEggPackStaple(product) && u === "ea" ? "яєць (шт)" : u}
              </option>
            ))}
          </select>
        </label>
        <label>
          Стратегія
          <select
            value={purchaseStrategy}
            onChange={(e) => setPurchaseStrategy(e.target.value as PurchaseStrategy)}
          >
            <option value="exact_need">Максимально близько до потреби</option>
            <option value="stock_up">Можна купити більше, якщо вигідніше</option>
          </select>
        </label>
        <label>
          Допустиме відхилення %
          <input
            value={tolerancePercent}
            onChange={(e) => setTolerancePercent(e.target.value)}
            inputMode="decimal"
          />
        </label>
        {purchaseStrategy === "stock_up" && (
          <label>
            Максимальна кількість
            <input
              value={maximumAmount}
              onChange={(e) => setMaximumAmount(e.target.value)}
              inputMode="decimal"
              placeholder="не вигадувати, якщо порожньо"
            />
          </label>
        )}
        <label>
          productType
          <input value={productType} onChange={(e) => setProductType(e.target.value)} />
        </label>
        <label>
          form
          <input value={form} onChange={(e) => setForm(e.target.value)} />
        </label>
        <label>
          variant
          <input value={variant} onChange={(e) => setVariant(e.target.value)} />
        </label>
        <label>
          Include keywords
          <input value={include} onChange={(e) => setInclude(e.target.value)} />
        </label>
        <label>
          Exclude keywords
          <input value={exclude} onChange={(e) => setExclude(e.target.value)} />
        </label>
        <div className="ps-stores">
          <p>Підтвердити товар у магазині (після зміни A/B старі mapping — needs_review)</p>
          {storeOffers.map((s) => (
            <label key={s.retailer}>
              {s.label}
              <span className="ps-offer">{s.name ?? "немає"}</span>
              {s.productId ? (
                <button
                  type="button"
                  onClick={() =>
                    setConfirmed((prev) => ({ ...prev, [s.retailer]: s.productId! }))
                  }
                >
                  {confirmed[s.retailer] === s.productId
                    ? "Підтверджено"
                    : "Підтвердити"}
                </button>
              ) : null}
            </label>
          ))}
        </div>
        <div className="ps-actions">
          <button type="button" className="ps-save" onClick={() => save(false)}>
            Зберегти
          </button>
          <button
            type="button"
            className="ps-save ps-save-rematch"
            onClick={() => save(true)}
          >
            Зберегти і оновити
          </button>
        </div>
      </div>
      <style jsx>{`
        .ps-back {
          position: fixed;
          inset: 0;
          background: rgba(20, 24, 20, 0.45);
          z-index: 80;
          display: grid;
          place-items: end center;
        }
        .ps-panel {
          width: min(520px, 100%);
          max-height: 92vh;
          overflow: auto;
          background: #fffdf8;
          padding: 1rem 1.1rem 1.4rem;
          display: grid;
          gap: 0.55rem;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        label {
          display: grid;
          gap: 0.2rem;
          font-size: 0.82rem;
        }
        input,
        select,
        button {
          font: inherit;
        }
        input,
        select {
          padding: 0.35rem 0.45rem;
        }
        .ps-offer {
          font-size: 0.78rem;
          opacity: 0.75;
        }
        .ps-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          margin-top: 0.4rem;
        }
        .ps-save {
          background: #2f4a3a;
          color: #fff;
          border: 0;
          padding: 0.55rem 0.8rem;
          cursor: pointer;
        }
        .ps-save-rematch {
          background: #1e4030;
        }
        .ps-hint {
          font-size: 0.75rem;
          opacity: 0.75;
          line-height: 1.35;
        }
        .ps-eggs {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.8rem;
        }
        .ps-eggs button {
          padding: 0.25rem 0.5rem;
          cursor: pointer;
        }
        .ps-eggs button.on {
          background: #1e4030;
          color: #fff;
          border-color: #1e4030;
        }
      `}</style>
    </div>
  );
}
