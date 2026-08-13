"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useIdentity } from "../../lib/identity";
import { DEV_TOOLS } from "../../lib/dev-tools";
import { compressImage } from "../../lib/image";
import { ItemPlaceholder } from "../../components/item-placeholder";

const DURATIONS = [
  { value: "1d", label: "1 day" },
  { value: "3d", label: "3 days" },
  { value: "5d", label: "5 days", default: true },
  { value: "7d", label: "7 days" },
  { value: "14d", label: "14 days" },
] as const;

const CATEGORIES = [
  { value: "", label: "Select a category" },
  { value: "art", label: "Art" },
  { value: "collectibles", label: "Collectibles" },
  { value: "watches", label: "Watches" },
  { value: "bags", label: "Bags & Accessories" },
  { value: "jewelry", label: "Jewelry" },
  { value: "wine", label: "Wine & Whiskey" },
  { value: "cars", label: "Cars" },
  { value: "furniture", label: "Furniture & Interior" },
  { value: "electronics", label: "Electronics" },
  { value: "other", label: "Other" },
] as const;

const CONDITIONS = [
  "New & Unused",
  "Like New",
  "Very Good",
  "Good",
  "Scratches & Stains",
  "Junk / For Parts",
] as const;

const FOCUS_STYLE = {
  borderColor: "var(--accent)",
  boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent)",
};
const UNFOCUS_STYLE = { borderColor: "var(--border)", boxShadow: "none" };

export default function CreateAuctionPage() {
  const router = useRouter();
  const { identity, isLoaded } = useIdentity();

  // Form state
  const [item, setItem] = useState("");
  const [description, setDescription] = useState("");
  const [startPrice, setStartPrice] = useState("");
  const [reservePrice, setReservePrice] = useState("");
  const [buyNowPrice, setBuyNowPrice] = useState("");
  const [duration, setDuration] = useState("5d");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState<string | null>(null);
  const [shipping, setShipping] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [mintUrl, setMintUrl] = useState(DEV_TOOLS ? "https://testnut.cashu.space" : "https://mint.minibits.cash/Bitcoin");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);

  // Modal state
  const [showModal, setShowModal] = useState(false);

  // Toast state
  const [toast, setToast] = useState<{ msg: string; icon: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, icon = "check_circle") => {
    setToast({ msg, icon });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const fileRef = useRef<HTMLInputElement>(null);

  // Validation errors per field
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const durationLabel = useMemo(() => {
    return DURATIONS.find((d) => d.value === duration)?.label ?? "5 days";
  }, [duration]);

  const categoryLabel = useMemo(() => {
    return CATEGORIES.find((c) => c.value === category)?.label ?? "—";
  }, [category]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!item.trim()) errs.item = "Enter item name";
    if (!description.trim()) errs.description = "Enter description";
    if (!condition) errs.condition = "Select condition";
    const sp = parseInt(startPrice, 10);
    if (!sp || sp < 1) errs.startPrice = "Enter start price (minimum 1 sat)";
    if (!mintUrl.trim()) errs.mintUrl = "Enter a valid Mint URL";
    if (!agreeTerms) errs.agreeTerms = "Agree to terms of service";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleOpenModal(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setShowModal(true);
  }

  async function handleConfirm() {
    if (!identity) return;

    const price = parseInt(startPrice, 10);
    if (isNaN(price) || price <= 0) {
      setError("Start price must be a positive number");
      return;
    }

    // Compute end time from duration
    const hoursMap: Record<string, number> = {
      "1d": 24,
      "3d": 72,
      "5d": 120,
      "7d": 168,
      "14d": 336,
    };
    const hours = hoursMap[duration] ?? 120;
    const endTime = Date.now() + hours * 60 * 60 * 1000;

    setShowModal(false);
    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        item: item.trim(),
        description: description.trim(),
        start_price: price,
        end_time: endTime,
        seller_pubkey: identity.pubkey,
        mint_url: mintUrl.trim(),
      };
      if (reservePrice) {
        const rp = parseInt(reservePrice, 10);
        if (!isNaN(rp) && rp > 0) body.reserve_price = rp;
      }
      if (buyNowPrice) {
        const bp = parseInt(buyNowPrice, 10);
        if (!isNaN(bp) && bp > 0) body.buy_now_price = bp;
      }
      if (category) body.category = category;
      if (condition) body.condition = condition;
      if (shipping) body.shipping = shipping;
      if (images.length > 0) {
        body.image = images[0];
        body.images = images;
      }

      const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001")
        .replace(/\/+$/, "")
        .replace(/\/api$/, "");
      const res = await fetch(`${apiBase}/api/auctions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "listing creation failed");
      }

      showToast("Auction created!");
      // Reset form
      setItem("");
      setDescription("");
      setStartPrice("");
      setReservePrice("");
      setBuyNowPrice("");
      setDuration("5d");
      setCategory("");
      setCondition(null);
      setShipping("");
      setAgreeTerms(false);
      setMintUrl(DEV_TOOLS ? "https://testnut.cashu.space" : "https://mint.minibits.cash/Bitcoin");
      setImages([]);
      setFieldErrors({});

      setTimeout(() => router.push("/"), 2000);
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files) {
      const results = await Promise.all(Array.from(files).map((f) => compressImage(f)));
      const ok = results.filter((r): r is string => r !== null);
      setImages((prev) => [...prev, ...ok].slice(0, 4));
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function handleCancel() {
    if (item || description || startPrice) {
      if (!confirm("Discard changes?")) return;
    }
    setItem("");
    setDescription("");
    setStartPrice("");
    setReservePrice("");
    setBuyNowPrice("");
    setDuration("5d");
    setCategory("");
    setCondition(null);
    setShipping("");
    setAgreeTerms(false);
    setMintUrl(DEV_TOOLS ? "https://testnut.cashu.space" : "https://mint.minibits.cash/Bitcoin");
    setImages([]);
    setFieldErrors({});
    showToast("Form cleared", "delete");
  }

  function errStyle(field: string) {
    return fieldErrors[field] ? { borderColor: "var(--red)" } : {};
  }

  // Shared input focus/blur handlers
  function handleFocus(e: React.FocusEvent<HTMLElement>) {
    const el = e.currentTarget;
    el.style.borderColor = "var(--accent)";
    el.style.boxShadow = "0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent)";
  }

  function handleBlur(e: React.FocusEvent<HTMLElement>, field?: string) {
    const el = e.currentTarget;
    if (!field || !fieldErrors[field]) {
      el.style.borderColor = "var(--border)";
      el.style.boxShadow = "none";
    }
  }

  const inputTextStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "10px 14px",
    fontSize: 14,
    fontFamily: "inherit",
    background: "var(--surface)",
    color: "var(--fg)",
    outline: "none",
    transition: "border-color .15s",
  };

  if (!isLoaded || !identity) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
        <p style={{ color: "var(--muted)", fontSize: 14, padding: "24px 0" }}>Loading identity…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
      {/* Breadcrumb */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "16px 0 24px",
          fontSize: 13,
          color: "var(--muted)",
          listStyle: "none",
        }}
      >
        <a href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>
          Home
        </a>
        <span style={{ color: "var(--border)" }}>/</span>
        <span style={{ color: "var(--fg)" }}>New Listing</span>
      </div>

      {/* Page header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 40,
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(22px, 2.5vw, 28px)",
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Create Listing
        </h1>
      </div>

      {/* Form grid: two columns */}
      <div
        className="resp-grid-form"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 40,
          alignItems: "start",
        }}
      >
        {/* ========== LEFT COLUMN: FORM ========== */}
        <form onSubmit={handleOpenModal}>
          {/* Item Image */}
          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Item Image{" "}
              <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>(max 4)</span>
            </label>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <div
              onClick={() => fileRef.current?.click()}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent)";
                e.currentTarget.style.background =
                  "color-mix(in srgb, var(--accent) 4%, transparent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.background = "transparent";
              }}
              style={{
                border: "2px dashed var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: 40,
                textAlign: "center",
                cursor: "pointer",
                transition: "border-color .15s, background .15s",
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8, color: "var(--muted)" }}>
                <span className="material-icons" style={{ fontSize: 28 }}>
                  upload
                </span>
              </div>
              <p style={{ fontSize: 14, color: "var(--muted)" }}>
                Click or drag & drop to add images
              </p>
              <span
                style={{
                  display: "inline-block",
                  marginTop: 8,
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: "8px 20px",
                  fontSize: 14,
                  background: "var(--surface)",
                  cursor: "pointer",
                }}
              >
                Select Images
              </span>
            </div>
            {images.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {images.map((src, i) => (
                  <div
                    key={`${src.slice(0, 24)}-${i}`}
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: "var(--radius)",
                      background: "#f3f4f6",
                      border: "1px solid var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--muted)",
                      fontSize: 10,
                      position: "relative",
                      overflow: "hidden",
                    }}
                    title={`Image ${i + 1}`}
                  >
                    <img
                      src={src}
                      alt={`Image ${i + 1}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeImage(i);
                      }}
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "var(--fg)",
                        color: "#fff",
                        border: "none",
                        fontSize: 11,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        lineHeight: 1,
                      }}
                    >
                      <span className="material-icons" style={{ fontSize: 11 }}>
                        close
                      </span>
                    </button>
                  </div>
                ))}
                {images.length < 4 && (
                  <div
                    onClick={() => fileRef.current?.click()}
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: "var(--radius)",
                      border: "1px dashed var(--border)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--border)",
                      fontSize: 24,
                      cursor: "pointer",
                    }}
                  >
                    <span className="material-icons" style={{ fontSize: 24 }}>
                      add
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Item Name */}
          <div style={{ marginBottom: 24 }}>
            <label
              htmlFor="itemName"
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Item Name <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <input
              id="itemName"
              type="text"
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="e.g. Rolex Submariner 116610LN"
              style={{
                ...inputTextStyle,
                ...errStyle("item"),
              }}
              onFocus={handleFocus}
              onBlur={(e) => handleBlur(e, "item")}
            />
            {fieldErrors.item && (
              <span style={{ fontSize: 12, color: "var(--red)", marginTop: 4, display: "block" }}>
                {fieldErrors.item}
              </span>
            )}
          </div>

          {/* Category */}
          <div style={{ marginBottom: 24 }}>
            <label
              htmlFor="category"
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Category <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{
                ...inputTextStyle,
                cursor: "pointer",
                color: category ? "var(--fg)" : "var(--muted)",
                appearance: "none",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23858585' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 12px center",
                paddingRight: 32,
                ...errStyle("category"),
              }}
              onFocus={handleFocus}
              onBlur={(e) => handleBlur(e, "category")}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div style={{ marginBottom: 24 }}>
            <label
              htmlFor="description"
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Description <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the item's condition, purchase date, accessories, etc. in detail."
              style={{
                ...inputTextStyle,
                resize: "vertical",
                minHeight: 140,
                ...errStyle("description"),
              }}
              onFocus={handleFocus}
              onBlur={(e) => handleBlur(e, "description")}
            />
            <div
              style={{
                fontSize: 12,
                color: "var(--muted)",
                marginTop: 4,
              }}
            >
              A detailed description helps attract higher bids. 300+ characters recommended.
            </div>
            {fieldErrors.description && (
              <span style={{ fontSize: 12, color: "var(--red)", marginTop: 4, display: "block" }}>
                {fieldErrors.description}
              </span>
            )}
          </div>

          {/* Condition */}
          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Condition <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {CONDITIONS.map((cond) => (
                <span
                  key={cond}
                  onClick={() => setCondition(cond === condition ? null : cond)}
                  onMouseEnter={(e) => {
                    if (cond !== condition) {
                      e.currentTarget.style.borderColor = "var(--accent)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (cond !== condition) {
                      e.currentTarget.style.borderColor = "var(--border)";
                    }
                  }}
                  style={{
                    border: `1px solid ${cond === condition ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 100,
                    padding: "6px 18px",
                    fontSize: 14,
                    background: cond === condition ? "var(--accent)" : "var(--surface)",
                    color: cond === condition ? "#fff" : "var(--fg)",
                    cursor: "pointer",
                    transition: "all .15s",
                  }}
                >
                  {cond}
                </span>
              ))}
            </div>
            {fieldErrors.condition && (
              <span style={{ fontSize: 12, color: "var(--red)", marginTop: 4, display: "block" }}>
                {fieldErrors.condition}
              </span>
            )}
          </div>

          {/* Pricing */}
          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Pricing
            </label>
            <div
              className="resp-grid-2col"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
              }}
            >
              <div>
                <label
                  htmlFor="startPrice"
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 400,
                    marginBottom: 6,
                  }}
                >
                  Starting Price <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input
                  id="startPrice"
                  type="number"
                  min="1"
                  value={startPrice}
                  onChange={(e) => setStartPrice(e.target.value)}
                  placeholder="1000"
                  style={{
                    ...inputTextStyle,
                    ...errStyle("startPrice"),
                  }}
                  onFocus={handleFocus}
                  onBlur={(e) => handleBlur(e, "startPrice")}
                />
                {fieldErrors.startPrice && (
                  <span
                    style={{ fontSize: 12, color: "var(--red)", marginTop: 4, display: "block" }}
                  >
                    {fieldErrors.startPrice}
                  </span>
                )}
              </div>
              <div>
                <label
                  htmlFor="reservePrice"
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 400,
                    marginBottom: 6,
                  }}
                >
                  Reserve Price{" "}
                  <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>
                    (optional, no sale below this)
                  </span>
                </label>
                <input
                  id="reservePrice"
                  type="number"
                  min="0"
                  value={reservePrice}
                  onChange={(e) => setReservePrice(e.target.value)}
                  placeholder="—"
                  style={inputTextStyle}
                  onFocus={handleFocus}
                  onBlur={(e) => handleBlur(e)}
                />
              </div>
              <div>
                <label
                  htmlFor="buyNowPrice"
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 400,
                    marginBottom: 6,
                  }}
                >
                  Buy Now Price{" "}
                  <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>
                    (optional)
                  </span>
                </label>
                <input
                  id="buyNowPrice"
                  type="number"
                  min="0"
                  value={buyNowPrice}
                  onChange={(e) => setBuyNowPrice(e.target.value)}
                  placeholder="—"
                  style={inputTextStyle}
                  onFocus={handleFocus}
                  onBlur={(e) => handleBlur(e)}
                />
              </div>
            </div>
          </div>

          {/* Auction Duration */}
          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Auction Duration <span style={{ color: "var(--red)" }}>*</span>
            </label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              {DURATIONS.map((d) => (
                <span
                  key={d.value}
                  onClick={() => setDuration(d.value)}
                  onMouseEnter={(e) => {
                    if (d.value !== duration) {
                      e.currentTarget.style.borderColor = "var(--accent)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (d.value !== duration) {
                      e.currentTarget.style.borderColor = "var(--border)";
                    }
                  }}
                  style={{
                    border: `1px solid ${d.value === duration ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 100,
                    padding: "6px 18px",
                    fontSize: 14,
                    background: d.value === duration ? "var(--accent)" : "var(--surface)",
                    color: d.value === duration ? "#fff" : "var(--fg)",
                    cursor: "pointer",
                    transition: "all .15s",
                  }}
                >
                  {d.label}
                </span>
              ))}
            </div>
          </div>

          {/* Shipping Method (optional free text) */}
          <div style={{ marginBottom: 24 }}>
            <label
              htmlFor="shippingMethod"
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              Shipping Method{" "}
              <span style={{ fontWeight: 400, color: "var(--muted)", fontSize: 12 }}>(optional)</span>
            </label>
            <input
              id="shippingMethod"
              type="text"
              value={shipping}
              onChange={(e) => setShipping(e.target.value)}
              placeholder="e.g. Ships worldwide, insured, buyer pays shipping"
              onFocus={handleFocus}
              onBlur={handleBlur}
              style={inputTextStyle}
            />
          </div>

          {/* Agreement */}
          <div style={{ marginBottom: 24 }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <input
                type="checkbox"
                id="agree1"
                checked={agreeTerms}
                onChange={(e) => setAgreeTerms(e.target.checked)}
                style={{
                  marginTop: 3,
                  width: 16,
                  height: 16,
                  accentColor: "var(--accent)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              />
              <label htmlFor="agree1" style={{ fontSize: 14, cursor: "pointer", fontWeight: 400 }}>
                I agree to the auction terms and guidelines
              </label>
            </div>
            {fieldErrors.agreeTerms && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--red)",
                  marginTop: 2,
                  marginLeft: 24,
                  display: "block",
                }}
              >
                {fieldErrors.agreeTerms}
              </span>
            )}
          </div>

          {/* Mint URL (hidden for power users) */}
          <div style={{ marginBottom: 24 }}>
            <label
              htmlFor="mintUrl"
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 400,
                marginBottom: 6,
                color: "var(--muted)",
              }}
            >
              Cashu Mint URL (bidders hold ecash on this mint)
            </label>
            <input
              id="mintUrl"
              type="url"
              list="mint-suggestions"
              value={mintUrl}
              onChange={(e) => setMintUrl(e.target.value)}
              placeholder={DEV_TOOLS ? "https://testnut.cashu.space" : "https://mint.minibits.cash/Bitcoin"}
              style={{
                ...inputTextStyle,
                fontSize: 13,
                ...errStyle("mintUrl"),
              }}
              onFocus={handleFocus}
              onBlur={(e) => handleBlur(e, "mintUrl")}
            />
            {fieldErrors.mintUrl && (
              <span style={{ fontSize: 12, color: "var(--red)", marginTop: 4, display: "block" }}>
                {fieldErrors.mintUrl}
              </span>
            )}
          </div>

          {/* Error */}
          {error && (
            <p style={{ color: "var(--red)", fontSize: 13, margin: "0 0 16px" }}>{error}</p>
          )}

          {/* Submit row */}
          <div
            style={{
              display: "flex",
              gap: 16,
              paddingTop: 24,
              borderTop: "1px solid var(--border)",
              marginTop: 24,
            }}
          >
            <button
              type="submit"
              disabled={submitting}
              style={{
                border: "none",
                borderRadius: "var(--radius)",
                background: "var(--accent)",
                color: "#fff",
                padding: "12px 32px",
                fontSize: 15,
                fontWeight: 500,
                fontFamily: "inherit",
                cursor: submitting ? "not-allowed" : "pointer",
                transition: "filter .15s",
                opacity: submitting ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!submitting) e.currentTarget.style.filter = "brightness(.92)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = "none";
              }}
            >
              {submitting ? "Publishing…" : "Publish"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              style={{
                marginLeft: "auto",
                border: "none",
                background: "transparent",
                color: "var(--muted)",
                padding: "12px 16px",
                fontSize: 13,
                fontFamily: "inherit",
                cursor: submitting ? "not-allowed" : "pointer",
                textDecoration: "underline",
              }}
            >
              Discard
            </button>
          </div>
        </form>

        {/* ========== RIGHT COLUMN: SIDEBAR ========== */}
        <div>
          {/* Preview card */}
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: 24,
            }}
          >
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                marginBottom: 16,
                paddingBottom: 8,
                borderBottom: "1px solid var(--border)",
              }}
            >
              Preview
            </h3>
            <div
              style={{
                aspectRatio: "16/10",
                background: "#f3f4f6",
                borderRadius: "var(--radius)",
                marginBottom: 16,
                overflow: "hidden",
                position: "relative",
              }}
            >
              {images[0] ? (
                <img
                  src={images[0]}
                  alt="Preview"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <ItemPlaceholder category={category} name={item} size={32} />
              )}
            </div>
            {[
              ["Item Name", item.trim() || "—"],
              ["Category", categoryLabel === "—" ? "Not selected" : categoryLabel],
              ["Condition", condition || "Not selected"],
              [
                "Starting Price",
                startPrice ? `${parseInt(startPrice, 10).toLocaleString()} sats` : "Not set",
              ],
              [
                "Reserve Price",
                reservePrice ? `${parseInt(reservePrice, 10).toLocaleString()} sats` : "None",
              ],
              [
                "Buy Now Price",
                buyNowPrice ? `${parseInt(buyNowPrice, 10).toLocaleString()} sats` : "None",
              ],
              ["Duration", durationLabel],
              ["Shipping", shipping || "—"],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  padding: "4px 0",
                  borderBottom: "1px dashed var(--border)",
                }}
              >
                <span style={{ color: "var(--muted)" }}>{label}</span>
                <span
                  style={{
                    fontWeight: 500,
                    textAlign: "right",
                    maxWidth: "60%",
                    wordBreak: "break-word",
                  }}
                >
                  {value}
                </span>
              </div>
            ))}
          </div>

          {/* Tips card */}
          <div
            style={{
              marginTop: 24,
              padding: 16,
              background: "color-mix(in srgb, var(--accent) 6%, transparent)",
              borderRadius: "var(--radius)",
            }}
          >
            <h4
              style={{
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 8,
                fontFamily: "var(--font-body)",
                letterSpacing: "normal",
              }}
            >
              💡 Tips for Higher Bids
            </h4>
            <ul
              style={{
                listStyle: "none",
                fontSize: 13,
                color: "var(--muted)",
                padding: 0,
                margin: 0,
              }}
            >
              {[
                "Take photos in bright light from multiple angles",
                "Describe scratches and stains honestly",
                "List box and certificate as included accessories",
                "Set a lower start price to attract bids",
                "Setting a buy-it-now price boosts interest",
              ].map((tip, i) => (
                <li
                  key={i}
                  style={{
                    padding: "2px 0 2px 16px",
                    position: "relative",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      left: 4,
                      color: "var(--accent)",
                    }}
                  >
                    •
                  </span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* ========== CONFIRMATION MODAL ========== */}
      {showModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "var(--radius-lg)",
              width: 480,
              maxWidth: "92vw",
              boxShadow: "0 24px 80px rgba(0,0,0,0.1)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "24px 28px 0",
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: 18,
                }}
              >
                Confirm Listing
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{
                  width: 28,
                  height: 28,
                  border: "none",
                  background: "var(--bg)",
                  borderRadius: "50%",
                  cursor: "pointer",
                  display: "grid",
                  placeItems: "center",
                  color: "var(--muted)",
                  fontSize: 16,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--border)";
                  e.currentTarget.style.color = "var(--fg)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg)";
                  e.currentTarget.style.color = "var(--muted)";
                }}
              >
                <span className="material-icons" style={{ fontSize: 16 }}>
                  close
                </span>
              </button>
            </div>
            <div style={{ padding: "20px 28px 28px" }}>
              <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16 }}>
                This listing will be registered on the auction server. Please review.
              </p>
              <table style={{ width: "100%" }}>
                <tbody>
                  {[
                    ["Item Name", item.trim()],
                    ["Starting Price", `${parseInt(startPrice, 10).toLocaleString()} sats`],
                    [
                      "Reserve Price",
                      reservePrice ? `${parseInt(reservePrice, 10).toLocaleString()} sats` : "None",
                    ],
                    [
                      "Buy Now Price",
                      buyNowPrice ? `${parseInt(buyNowPrice, 10).toLocaleString()} sats` : "None",
                    ],
                    ["Duration", durationLabel],
                    ["Category", categoryLabel],
                    ["Condition", condition || "—"],
                    ["Shipping", shipping || "—"],
                    ["Mint URL", mintUrl],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td
                        style={{
                          padding: "8px 0",
                          fontSize: 12,
                          color: "var(--muted)",
                          letterSpacing: "0.04em",
                          width: "30%",
                          verticalAlign: "top",
                          paddingRight: 12,
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {label}
                      </td>
                      <td
                        style={{
                          padding: "8px 0",
                          fontSize: 14,
                          fontWeight: 500,
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div
                className="resp-grid-2col"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginTop: 20,
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "12px 24px",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--fg)",
                    font: "500 14px/1 var(--font-body)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--muted)";
                    e.currentTarget.style.background = "var(--bg)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--surface)";
                  }}
                >
                  Back to Edit
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={submitting}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    padding: "12px 24px",
                    borderRadius: "var(--radius)",
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    font: "600 14px/1 var(--font-body)",
                    cursor: submitting ? "not-allowed" : "pointer",
                    transition: "all 0.15s",
                    opacity: submitting ? 0.5 : 1,
                  }}
                >
                  {submitting ? "Publishing…" : "Publish"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========== TOAST ========== */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 32,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "14px 24px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 14,
            boxShadow: "0 8px 32px rgba(0,0,0,0.1)",
            zIndex: 300,
            pointerEvents: "none",
            transition: "all 0.4s ease",
          }}
        >
          <span className="material-icons" style={{ fontSize: 18 }}>
            {toast.icon}
          </span>
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}
