import {
  createContext,
  useContext,
  useId,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { registerSW } from "virtual:pwa-register";
import type { IScannerControls } from "@zxing/browser";

import {
  accountUri,
  duplicateKey,
  emptyVault,
  generateCode,
  mergeAccounts,
  newAccount,
  validateAccount,
  type TotpAccount,
  type VaultData,
} from "./model";
import {
  db,
  MAX_BACKUP,
  newSession,
  open,
  parseEnvelope,
  readVault,
  seal,
  writeVault,
  type Session,
} from "./vault";
import { addBatch, parseImport, type Migration } from "./imports";
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    shield: (
      <>
        <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V3H3v13h5" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    qr: (
      <>
        <path d="M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6z" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.shield}
    </svg>
  );
}
const ErrorContext = createContext("");
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const modalError = useContext(ErrorContext);
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    d.querySelector<HTMLInputElement>(
      "input:not([type=file]), textarea, select",
    )?.focus();
    return () => d.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} aria-labelledby={titleId}>
      <header className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      {modalError && (
        <p className="notice error" role="alert">
          {modalError}
        </p>
      )}
      {children}
    </dialog>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The operation could not be completed.";
export default function App() {
  const [data, setData] = useState<VaultData | null>(null),
    [exists, setExists] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [page, setPage] = useState<"accounts" | "settings">("accounts"),
    [query, setQuery] = useState(""),
    [modal, setModal] = useState<
      "add" | "import" | "restore" | "password" | "deleteVault" | null
    >(null),
    [editing, setEditing] = useState<TotpAccount | null>(null),
    [deleting, setDeleting] = useState<TotpAccount | null>(null),
    [exporting, setExporting] = useState<TotpAccount | null>(null),
    [qr, setQr] = useState(""),
    [online, setOnline] = useState(navigator.onLine),
    [offlineReady, setOfflineReady] = useState(false),
    [update, setUpdate] = useState(false),
    [now, setNow] = useState(Date.now()),
    [clockWarning, setClockWarning] = useState(false);
  const session = useRef<Session | null>(null),
    revision = useRef(0),
    generation = useRef(0),
    working = useRef(false),
    activity = useRef({ wall: Date.now(), mono: performance.now() }),
    updater = useRef<((reload?: boolean) => Promise<void>) | null>(null),
    channel = useRef<BroadcastChannel | null>(null);
  const lock = useCallback(() => {
    generation.current++;
    session.current = null;
    setData(null);
    setModal(null);
    setEditing(null);
    setDeleting(null);
    setExporting(null);
    setQr("");
    setQuery("");
    setError("");
    setToast("");
  }, []);
  useEffect(() => {
    readVault()
      .then((v) => setExists(!!v))
      .catch(() =>
        setError(
          "Local storage is unavailable. Allow browser storage and reload.",
        ),
      );
    if ("BroadcastChannel" in window) {
      const c = new BroadcastChannel("stillkey-vault-events");
      channel.current = c;
      c.onmessage = () => {
        lock();
        void readVault().then((v) => setExists(!!v));
      };
      return () => c.close();
    }
  }, [lock]);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.ready.then(() => setOfflineReady(true));
    updater.current = registerSW({
      onOfflineReady: () => setOfflineReady(true),
      onNeedRefresh: () => setUpdate(true),
      onRegisterError: () =>
        setToast("Offline setup failed. Reopen online to try again."),
    });
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const theme = data?.settings.theme ?? "system";
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [data?.settings.theme]);
  useEffect(() => {
    if (!data) return;
    const touch = () => {
      if (
        Math.max(
          Date.now() - activity.current.wall,
          performance.now() - activity.current.mono,
        ) >
        data.settings.autoLock * 60000
      ) {
        lock();
        return;
      }
      activity.current = { wall: Date.now(), mono: performance.now() };
    };
    const visibility = () => {
      setNow(Date.now());
      if (
        (document.hidden && data.settings.backgroundLock) ||
        Math.max(
          Date.now() - activity.current.wall,
          performance.now() - activity.current.mono,
        ) >
          data.settings.autoLock * 60000
      )
        lock();
    };
    let lastWall = Date.now(),
      lastMono = performance.now();
    const timer = setInterval(() => {
      const time = Date.now(),
        mono = performance.now();
      if (Math.abs(time - lastWall - (mono - lastMono)) > 5000)
        setClockWarning(true);
      lastWall = time;
      lastMono = mono;
      setNow(time);
      if (
        Math.max(time - activity.current.wall, mono - activity.current.mono) >
        data.settings.autoLock * 60000
      )
        lock();
    }, 250);
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", visibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", visibility);
    };
  }, [data, lock]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        data &&
        !modal &&
        !editing &&
        !deleting &&
        !exporting &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>('[aria-label="Search accounts"]')
          ?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [data, modal, editing, deleting, exporting]);
  async function action(fn: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function persist(
    next: VaultData,
    changed = true,
    nextSession = session.current,
  ) {
    if (!nextSession || !session.current)
      throw Error("Unlock the vault first.");
    const epoch = generation.current;
    const value = {
      ...next,
      changedAt: changed ? new Date().toISOString() : next.changedAt,
    };
    const encrypted = await seal(value, nextSession);
    if (epoch !== generation.current)
      throw Error("Vault locked. Please unlock and try again.");
    revision.current = await writeVault(encrypted, revision.current);
    channel.current?.postMessage("changed");
    if (epoch === generation.current) {
      session.current = nextSession;
      setData(value);
    }
  }
  async function unlock(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      fields = new FormData(form),
      password = String(fields.get("password"));
    if (!exists && password !== fields.get("confirm")) {
      setError("Passwords do not match.");
      return;
    }
    form.reset();
    await action(async () => {
      const epoch = generation.current;
      const stored = await readVault();
      let result: { data: VaultData; session: Session };
      if (stored) {
        result = await open(stored.envelope, password);
        revision.current = stored.revision;
      } else {
        const s = await newSession(password);
        result = { session: s, data: emptyVault() };
        revision.current = await writeVault(await seal(result.data, s), 0);
        setExists(true);
        channel.current?.postMessage("changed");
      }
      if (epoch !== generation.current) return;
      session.current = result.session;
      setData(result.data);
      activity.current = { wall: Date.now(), mono: performance.now() };
      setPage("accounts");
      void navigator.storage?.persist?.();
    });
  }
  async function saveAccount(input: TotpAccount) {
    await action(async () => {
      if (!data) return;
      const a = validateAccount(input);
      if (
        data.accounts.some(
          (x) => x.id !== a.id && duplicateKey(x) === duplicateKey(a),
        )
      )
        throw Error("This account already exists in your vault.");
      await persist({
        ...data,
        accounts: editing
          ? data.accounts.map((x) => (x.id === a.id ? a : x))
          : [...data.accounts, { ...a, sortOrder: data.accounts.length }],
      });
      setEditing(null);
      setModal(null);
      setToast("Account saved.");
    });
  }
  async function backup() {
    await action(async () => {
      if (!data || !session.current) return;
      const value = { ...data, backedUpAt: new Date().toISOString() };
      const encrypted = await seal(value, session.current);
      download(
        JSON.stringify(encrypted),
        "stillkey-backup-" + new Date().toISOString().slice(0, 10) + ".json",
        "application/json",
      );
      await persist(value, false);
      setToast("Encrypted backup downloaded. Keep it somewhere safe.");
    });
  }
  const accounts =
    data?.accounts
      .filter((a) =>
        `${a.displayLabel} ${a.issuer} ${a.accountName}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .sort((a, b) =>
        data.settings.sorting === "alphabetical"
          ? a.displayLabel.localeCompare(b.displayLabel)
          : a.sortOrder - b.sortOrder,
      ) ?? [];
  const needsBackup =
    data &&
    (!data.backedUpAt || data.changedAt > data.backedUpAt) &&
    data.accounts.length > 0;
  return (
    <ErrorContext.Provider value={error}>
      <div className="app">
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPage("accounts");
            }}
          >
            <span className="brand-mark">
              <Icon name="shield" size={25} />
            </span>
            stillkey<span className="brand-dot">.</span>
          </a>
          <span className="eyebrow sidebar-caption">YOUR PRIVATE SPACE</span>
          <nav aria-label="Main navigation">
            <button
              className={page === "accounts" ? "nav active" : "nav"}
              onClick={() => setPage("accounts")}
            >
              <Icon name="grid" />
              Accounts{" "}
              {data && (
                <span className="nav-count">{data.accounts.length}</span>
              )}
            </button>
            <button
              className={page === "settings" ? "nav active" : "nav"}
              onClick={() => setPage("settings")}
              disabled={!data}
            >
              <Icon name="settings" />
              Settings
            </button>
          </nav>
          <div className="sidebar-bottom">
            <div className="privacy-icon">
              <Icon name="shield" />
            </div>
            <strong>Only on your device.</strong>
            <p>
              No accounts. No cloud.
              <br />
              Just you and your codes.
            </p>
            <div className="local-status">
              <i /> OFFLINE-FIRST · V1.0.0
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumb">
              Your workspace <span>/</span>{" "}
              <strong>
                {page === "accounts" ? "Authenticator" : "Settings"}
              </strong>
            </div>
            <div className="top-actions">
              <span className="status">
                <i />
                {!online
                  ? "Offline"
                  : offlineReady
                    ? "Available offline"
                    : "Local vault"}
              </span>
              {data && (
                <button className="quiet" onClick={lock}>
                  <Icon name="lock" size={16} />
                  Lock vault
                </button>
              )}
            </div>
          </header>
          <main>
            {error && (
              <div className="notice error" role="alert">
                {error}
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError("")}
                >
                  ×
                </button>
              </div>
            )}
            {update && (
              <div className="notice">
                An app update is ready. Your encrypted vault will be preserved.
                <button
                  disabled={busy}
                  onClick={() => {
                    lock();
                    void updater.current?.(true);
                  }}
                >
                  Lock & update
                </button>
              </div>
            )}
            {!data ? (
              <section className="welcome">
                <div className="welcome-art">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="large-shield">
                    <Icon name="shield" size={52} />
                  </div>
                  <span className="art-label">PRIVATE BY DESIGN</span>
                </div>
                <span className="eyebrow">A LITTLE PEACE OF MIND</span>
                <h1>
                  {exists ? "Welcome back." : "Your codes.\nYour device."}
                </h1>
                <p className="welcome-description">
                  {exists
                    ? "Unlock your vault to access your authentication codes."
                    : "A quiet, secure home for your two-factor codes. Encrypted on this device. Ready wherever you are."}
                </p>
                <form className="unlock-form" onSubmit={unlock}>
                  <Field label="Master password">
                    <input
                      name="password"
                      type="password"
                      autoComplete={
                        exists ? "current-password" : "new-password"
                      }
                      minLength={exists ? 1 : 12}
                      maxLength={1024}
                      required
                      placeholder={
                        exists
                          ? "Enter your master password"
                          : "At least 12 characters"
                      }
                    />
                  </Field>
                  {!exists && (
                    <Field label="Confirm master password">
                      <input
                        name="confirm"
                        type="password"
                        autoComplete="new-password"
                        required
                        placeholder="Enter your password again"
                      />
                    </Field>
                  )}
                  <button
                    className="primary full"
                    disabled={busy || exists === null}
                  >
                    {busy
                      ? "Securing your vault…"
                      : exists
                        ? "Unlock vault"
                        : "Create your private vault"}
                    <Icon name="arrow" size={18} />
                  </button>
                </form>
                <p className="small lock-note">
                  <Icon name="lock" size={14} />
                  {exists
                    ? "Your password stays with you. Always."
                    : "No password recovery. Keep your password and encrypted backups safe."}
                </p>
                {exists && (
                  <button
                    className="text-button"
                    onClick={() => setModal("restore")}
                  >
                    Recover accounts from an encrypted backup
                  </button>
                )}
              </section>
            ) : page === "accounts" ? (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">SAFE. SIMPLE. YOURS.</span>
                    <h1>
                      Your accounts<span className="heading-dot">.</span>
                    </h1>
                    <p>One place for your codes. Nothing leaves this device.</p>
                  </div>
                  <button className="primary" onClick={() => setModal("add")}>
                    <Icon name="plus" size={18} />
                    Add account
                  </button>
                </div>
                <div className="toolbar">
                  <label className="search">
                    <Icon name="search" />
                    <input
                      aria-label="Search accounts"
                      placeholder="Search your accounts…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <kbd>/</kbd>
                  </label>
                  <select
                    aria-label="Sort accounts"
                    value={data.settings.sorting}
                    onChange={(e) =>
                      void action(() =>
                        persist(
                          {
                            ...data,
                            settings: {
                              ...data.settings,
                              sorting: e.target.value as
                                "manual" | "alphabetical",
                            },
                          },
                          false,
                        ),
                      )
                    }
                  >
                    <option value="manual">Manual order</option>
                    <option value="alphabetical">A → Z</option>
                  </select>
                  <button
                    className="secondary"
                    onClick={() => setModal("import")}
                  >
                    <Icon name="qr" size={17} />
                    Import
                  </button>
                </div>
                {clockWarning && (
                  <div className="notice">
                    Your device clock changed. Check automatic date and time if
                    a code is rejected.
                  </div>
                )}
                <div className="list-heading">
                  <span>
                    {accounts.length}{" "}
                    {accounts.length === 1 ? "ACCOUNT" : "ACCOUNTS"}
                  </span>
                  <span>
                    <i className="tiny-dot" /> Codes refresh automatically
                  </span>
                </div>
                {accounts.length ? (
                  <div className="account-grid">
                    {accounts.map((a, index) => {
                      const code = generateCode(a, now),
                        remaining =
                          a.period - (Math.floor(now / 1000) % a.period);
                      return (
                        <article className="account-card" key={a.id}>
                          <div className="account-top">
                            <div
                              className={
                                "service-avatar tone-" +
                                (a.displayLabel.charCodeAt(0) % 5)
                              }
                            >
                              {a.displayLabel.slice(0, 1).toUpperCase()}
                            </div>
                            <div className="account-title">
                              <h2>{a.displayLabel}</h2>
                              <p>
                                {a.issuer}
                                {data.settings.showIdentifiers &&
                                  a.accountName &&
                                  `${a.issuer ? " · " : ""}${a.accountName}`}
                              </p>
                            </div>
                            <details className="menu">
                              <summary
                                aria-label={`Options for ${a.displayLabel}`}
                              >
                                •••
                              </summary>
                              <div className="menu-items">
                                <button onClick={() => setEditing(a)}>
                                  Edit account
                                </button>
                                <button
                                  onClick={() => {
                                    setQr("");
                                    setExporting(a);
                                  }}
                                >
                                  Export QR code
                                </button>
                                {data.settings.sorting === "manual" && (
                                  <>
                                    <button
                                      disabled={index === 0 || !!query || busy}
                                      onClick={() =>
                                        void action(async () => {
                                          const all = [...accounts];
                                          [all[index - 1], all[index]] = [
                                            all[index],
                                            all[index - 1],
                                          ];
                                          await persist({
                                            ...data,
                                            accounts: all.map((x, i) => ({
                                              ...x,
                                              sortOrder: i,
                                            })),
                                          });
                                        })
                                      }
                                    >
                                      Move up
                                    </button>
                                    <button
                                      disabled={
                                        index === accounts.length - 1 ||
                                        !!query ||
                                        busy
                                      }
                                      onClick={() =>
                                        void action(async () => {
                                          const all = [...accounts];
                                          [all[index], all[index + 1]] = [
                                            all[index + 1],
                                            all[index],
                                          ];
                                          await persist({
                                            ...data,
                                            accounts: all.map((x, i) => ({
                                              ...x,
                                              sortOrder: i,
                                            })),
                                          });
                                        })
                                      }
                                    >
                                      Move down
                                    </button>
                                  </>
                                )}
                                <button
                                  className="danger-text"
                                  onClick={() => setDeleting(a)}
                                >
                                  Delete account
                                </button>
                              </div>
                            </details>
                          </div>
                          <div className="code-row">
                            <span className="otp" aria-label={`Code ${code}`}>
                              {code.slice(0, code.length / 2)}
                              <span> </span>
                              {code.slice(code.length / 2)}
                            </span>
                            <button
                              className="copy-button"
                              aria-label={`Copy code for ${a.displayLabel}`}
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(generateCode(a))
                                  .then(() =>
                                    setToast(
                                      `Code copied for ${a.displayLabel}.`,
                                    ),
                                  )
                                  .catch(() =>
                                    setError(
                                      "Clipboard is unavailable. Copy the displayed code manually.",
                                    ),
                                  )
                              }
                            >
                              <Icon name="copy" />
                            </button>
                          </div>
                          <div className="account-footer">
                            <div
                              className="progress"
                              role="progressbar"
                              aria-label="Time remaining"
                              aria-valuenow={remaining}
                              aria-valuemin={0}
                              aria-valuemax={a.period}
                            >
                              <span
                                style={{
                                  width: `${(remaining / a.period) * 100}%`,
                                }}
                              />
                            </div>
                            <span className={remaining <= 5 ? "expiring" : ""}>
                              {remaining}s
                            </span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <section className="empty-state">
                    <div className="empty-icon">
                      <Icon name={query ? "search" : "qr"} size={33} />
                    </div>
                    <h2>
                      {query
                        ? "No matching accounts"
                        : "Make yourself at home."}
                    </h2>
                    <p>
                      {query
                        ? "Try a different name, service, or account identifier."
                        : "Add your first account to keep your authentication codes close, and everything else out."}
                    </p>
                    {!query && (
                      <div className="empty-actions">
                        <button
                          className="primary"
                          onClick={() => setModal("add")}
                        >
                          <Icon name="plus" size={17} />
                          Add your first account
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setModal("import")}
                        >
                          Import from another authenticator <span>↗</span>
                        </button>
                      </div>
                    )}
                  </section>
                )}
                {needsBackup && (
                  <div className="backup-banner">
                    <span className="banner-icon">
                      <Icon name="download" />
                    </span>
                    <div>
                      <strong>A small backup. A lot of peace of mind.</strong>
                      <p>
                        Your vault has changes. Save an encrypted backup
                        somewhere safe.
                      </p>
                    </div>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void backup()}
                    >
                      Back up vault <Icon name="arrow" size={16} />
                    </button>
                  </div>
                )}
                <div className="assurance">
                  <Icon name="shield" size={15} />
                  Encrypted on your device<span>·</span>No cloud, no tracking
                  <span>·</span>Always yours
                </div>
              </>
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">MAKE IT YOURS</span>
                    <h1>
                      Settings<span className="heading-dot">.</span>
                    </h1>
                    <p>A little control over your private space.</p>
                  </div>
                </div>
                <section className="settings-panel">
                  <h2>Preferences</h2>
                  <Field label="Appearance">
                    <select
                      value={data.settings.theme}
                      onChange={(e) =>
                        void action(() =>
                          persist(
                            {
                              ...data,
                              settings: {
                                ...data.settings,
                                theme: e.target.value as
                                  "system" | "light" | "dark",
                              },
                            },
                            false,
                          ),
                        )
                      }
                    >
                      <option value="system">Follow device</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </Field>
                  <Field label="Default sorting">
                    <select
                      value={data.settings.sorting}
                      onChange={(e) =>
                        void action(() =>
                          persist(
                            {
                              ...data,
                              settings: {
                                ...data.settings,
                                sorting: e.target.value as
                                  "manual" | "alphabetical",
                              },
                            },
                            false,
                          ),
                        )
                      }
                    >
                      <option value="manual">Manual</option>
                      <option value="alphabetical">Alphabetical</option>
                    </select>
                  </Field>
                  <Field label="Lock after inactivity">
                    <select
                      value={data.settings.autoLock}
                      onChange={(e) =>
                        void action(() =>
                          persist(
                            {
                              ...data,
                              settings: {
                                ...data.settings,
                                autoLock: Number(e.target.value),
                              },
                            },
                            false,
                          ),
                        )
                      }
                    >
                      {[1, 5, 15, 30, 60].map((n) => (
                        <option key={n} value={n}>
                          {n} minutes
                        </option>
                      ))}
                    </select>
                  </Field>
                  {(["backgroundLock", "showIdentifiers"] as const).map(
                    (key) => (
                      <label className="toggle" key={key}>
                        <span>
                          {key === "backgroundLock"
                            ? "Lock when backgrounded"
                            : "Show account identifiers"}
                        </span>
                        <input
                          type="checkbox"
                          checked={data.settings[key]}
                          onChange={(e) =>
                            void action(() =>
                              persist(
                                {
                                  ...data,
                                  settings: {
                                    ...data.settings,
                                    [key]: e.target.checked,
                                  },
                                },
                                false,
                              ),
                            )
                          }
                        />
                      </label>
                    ),
                  )}
                </section>
                <section className="settings-panel">
                  <h2>Vault & recovery</h2>
                  <p>
                    Backups use your current master password. Older backups keep
                    their original password.
                  </p>
                  <div className="settings-actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void backup()}
                    >
                      Export encrypted backup
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setModal("restore")}
                    >
                      Restore backup
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setModal("password")}
                    >
                      Change master password
                    </button>
                  </div>
                </section>
                <section className="settings-panel">
                  <h2>At home, even offline</h2>
                  <p>
                    Install Stillkey using your browser’s install button. On
                    iPhone or iPad, open Safari, tap Share, then Add to Home
                    Screen. Open the app online once and wait for “Available
                    offline” before going offline.
                  </p>
                  <p className="small">
                    Stillkey 1.0.0 ·{" "}
                    {online ? "Device is online" : "Device is offline"} · All
                    processing is local.
                  </p>
                </section>
                <section className="settings-panel danger-zone">
                  <h2>Delete local vault</h2>
                  <p>
                    Remove all accounts from this browser. Recovery requires an
                    encrypted backup and its password.
                  </p>
                  <button
                    className="danger"
                    onClick={() => setModal("deleteVault")}
                  >
                    Delete local vault
                  </button>
                </section>
              </>
            )}
          </main>
          <footer className="page-footer">
            <span>Built for your peace of mind.</span>
            <span>
              <Icon name="lock" size={12} /> Local by nature.
            </span>
          </footer>
        </div>
        {toast && (
          <div role="status" className="toast">
            <Icon name="check" size={18} />
            {toast}
          </div>
        )}
        {(modal === "add" || editing) && data && (
          <Modal
            title={editing ? "Edit account" : "Add an account"}
            close={() => {
              setModal(null);
              setEditing(null);
            }}
          >
            <AccountForm account={editing} busy={busy} save={saveAccount} />
            {!editing && (
              <button
                className="text-button full"
                onClick={() => setModal("import")}
              >
                Scan a QR code or import accounts instead
              </button>
            )}
          </Modal>
        )}
        {modal === "import" && data && (
          <Modal title="Import accounts" close={() => setModal(null)}>
            <ImportForm
              existing={data.accounts}
              busy={busy}
              report={setError}
              commit={async (incoming) => {
                await action(async () => {
                  await persist({
                    ...data,
                    accounts: mergeAccounts(data.accounts, incoming),
                  });
                  setModal(null);
                  setToast("Accounts imported. Duplicates were skipped.");
                });
              }}
            />
          </Modal>
        )}
        {deleting && data && (
          <Modal title="Delete account?" close={() => setDeleting(null)}>
            <p>
              Remove <strong>{deleting.displayLabel}</strong> from this vault?
              Make sure you have another way to sign in to this service.
            </p>
            <button
              className="danger full"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await persist({
                    ...data,
                    accounts: data.accounts.filter((a) => a.id !== deleting.id),
                  });
                  setDeleting(null);
                })
              }
            >
              Delete account
            </button>
          </Modal>
        )}
        {exporting && (
          <Modal
            title="Export account QR"
            close={() => {
              setExporting(null);
              setQr("");
            }}
          >
            {!qr ? (
              <>
                <p className="notice warning">
                  This QR code contains the account’s secret. Anyone with it can
                  generate your sign-in codes. Do not share it or save it to
                  cloud photos.
                </p>
                <button
                  className="primary full"
                  onClick={() => {
                    const epoch = generation.current;
                    void action(async () => {
                      const { default: QRCode } = await import("qrcode");
                      const value = await QRCode.toDataURL(
                        accountUri(exporting),
                        { width: 320, margin: 2 },
                      );
                      if (epoch === generation.current) setQr(value);
                    });
                  }}
                >
                  I understand — reveal QR
                </button>
              </>
            ) : (
              <div className="qr-export">
                <img src={qr} alt="Sensitive account QR code" />
                <p>{exporting.displayLabel}</p>
                <a className="secondary" href={qr} download="account-qr.png">
                  Download secret QR image
                </a>
              </div>
            )}
          </Modal>
        )}
        {modal === "restore" && (
          <Modal title="Restore encrypted backup" close={() => setModal(null)}>
            <RestoreForm
              unlocked={!!data}
              busy={busy}
              restore={async (file, password, replace) => {
                const epoch = generation.current;
                await action(async () => {
                  const restored = await open(
                    parseEnvelope(await file.text()),
                    password,
                  );
                  if (epoch !== generation.current)
                    throw Error("Vault locked. Please try again.");
                  if (data) {
                    await persist({
                      ...data,
                      accounts: replace
                        ? restored.data.accounts
                        : mergeAccounts(data.accounts, restored.data.accounts),
                    });
                  } else {
                    const current = await readVault();
                    revision.current = current?.revision ?? 0;
                    const envelope = await seal(
                      restored.data,
                      restored.session,
                    );
                    revision.current = await writeVault(
                      envelope,
                      revision.current,
                    );
                    channel.current?.postMessage("changed");
                    if (epoch !== generation.current) return;
                    session.current = restored.session;
                    setData(restored.data);
                    setExists(true);
                    activity.current = {
                      wall: Date.now(),
                      mono: performance.now(),
                    };
                  }
                  setModal(null);
                  setToast("Backup restored successfully.");
                });
              }}
            />
          </Modal>
        )}
        {modal === "password" && data && (
          <Modal title="Change master password" close={() => setModal(null)}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget,
                  f = new FormData(form);
                const old = String(f.get("old")),
                  next = String(f.get("next"));
                if (next !== f.get("confirm")) {
                  setError("Passwords do not match.");
                  return;
                }
                form.reset();
                void action(async () => {
                  const stored = await readVault();
                  if (!stored) throw Error("Vault not found.");
                  await open(stored.envelope, old);
                  await persist(data, true, await newSession(next));
                  setModal(null);
                  setToast("Password changed. Create a new backup.");
                });
              }}
            >
              <Field label="Current password">
                <input
                  name="old"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Field label="New password">
                <input
                  name="next"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={1024}
                  required
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                />
              </Field>
              <p className="small">
                Existing backups still use the password they were created with.
              </p>
              <button className="primary full" disabled={busy}>
                Change password
              </button>
            </form>
          </Modal>
        )}
        {modal === "deleteVault" && (
          <Modal
            title="Delete this vault permanently?"
            close={() => setModal(null)}
          >
            <p>
              All local accounts will be removed. This cannot be undone without
              a backup. Type DELETE to confirm.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  new FormData(e.currentTarget).get("confirmation") !== "DELETE"
                )
                  return;
                void action(async () => {
                  await db.transaction("rw", db.vault, async () => {
                    const current = await readVault();
                    if (current?.revision !== revision.current)
                      throw Error(
                        "Vault changed. Lock and unlock before deleting.",
                      );
                    await db.vault.delete("main");
                  });
                  channel.current?.postMessage("changed");
                  lock();
                  setExists(false);
                  revision.current = 0;
                });
              }}
            >
              <input
                aria-label="Type DELETE"
                name="confirmation"
                pattern="DELETE"
                required
                autoComplete="off"
              />
              <button className="danger full" disabled={busy}>
                Permanently delete vault
              </button>
            </form>
          </Modal>
        )}
      </div>
    </ErrorContext.Provider>
  );
}
function AccountForm({
  account,
  busy,
  save,
}: {
  account: TotpAccount | null;
  busy: boolean;
  save: (a: TotpAccount) => Promise<void>;
}) {
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          const a = newAccount({
            ...account,
            displayLabel: String(f.get("label")),
            issuer: String(f.get("issuer")),
            accountName: String(f.get("accountName")),
            secretBase32: account?.secretBase32 ?? String(f.get("secret")),
            algorithm: String(f.get("algorithm")) as TotpAccount["algorithm"],
            digits: Number(f.get("digits")) as 6 | 8,
            period: Number(f.get("period")),
            updatedAt: new Date().toISOString(),
          });
          void save(a);
        } catch (e) {
          setError(errorText(e));
        }
      }}
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Field label="Display label">
        <input
          name="label"
          maxLength={200}
          defaultValue={account?.displayLabel}
          placeholder="e.g. Personal email"
          required
          autoFocus
        />
      </Field>
      <div className="form-row">
        <Field label="Issuer / service">
          <input
            name="issuer"
            maxLength={200}
            defaultValue={account?.issuer}
            placeholder="e.g. Google"
          />
        </Field>
        <Field label="Account identifier">
          <input
            name="accountName"
            maxLength={200}
            defaultValue={account?.accountName}
            placeholder="you@example.com"
          />
        </Field>
      </div>
      {!account && (
        <Field label="Setup key (Base32 secret)">
          <input
            name="secret"
            autoComplete="off"
            spellCheck={false}
            maxLength={2048}
            required
            placeholder="Enter the key from your service"
          />
        </Field>
      )}
      <div className="form-row">
        <Field label="Algorithm">
          <select name="algorithm" defaultValue={account?.algorithm ?? "SHA1"}>
            <option>SHA1</option>
            <option>SHA256</option>
            <option>SHA512</option>
          </select>
        </Field>
        <Field label="Digits">
          <select name="digits" defaultValue={account?.digits ?? 6}>
            <option>6</option>
            <option>8</option>
          </select>
        </Field>
        <Field label="Period (seconds)">
          <input
            name="period"
            type="number"
            min={5}
            max={300}
            defaultValue={account?.period ?? 30}
            required
          />
        </Field>
      </div>
      <p className="small">
        Use the algorithm, digits, and period supplied by your service.
      </p>
      <button className="primary full" disabled={busy}>
        {busy ? "Saving…" : "Save account"}
      </button>
    </form>
  );
}
function ImportForm({
  existing,
  busy,
  report,
  commit,
}: {
  existing: TotpAccount[];
  busy: boolean;
  report: (s: string) => void;
  commit: (a: TotpAccount[]) => Promise<void>;
}) {
  const [text, setText] = useState(""),
    [parts, setParts] = useState<Migration[]>([]),
    [standard, setStandard] = useState<TotpAccount[]>([]),
    [error, setError] = useState(""),
    [camera, setCamera] = useState(false),
    [processing, setProcessing] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    controls = useRef<IScannerControls | null>(null);
  const partsRef = useRef(parts);
  partsRef.current = parts;
  const accept = (value: string) => {
    try {
      const parsed = parseImport(value);
      if (parsed.kind === "standard") {
        if (partsRef.current.length)
          throw Error("Finish or clear the current migration batch first.");
        if (standard.length + parsed.accounts.length > 2000)
          throw Error("Import limit is 2,000 accounts.");
        setStandard((old) => [...old, ...parsed.accounts]);
      } else {
        if (standard.length)
          throw Error(
            "Clear the current preview before scanning a migration batch.",
          );
        const next = addBatch(partsRef.current, parsed.migration);
        partsRef.current = next;
        setParts(next);
      }
      setText("");
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  };
  const acceptRef = useRef(accept);
  acceptRef.current = accept;
  useEffect(() => {
    if (!camera) return;
    let disposed = false;
    void import("@zxing/browser")
      .then(({ BrowserQRCodeReader }) => {
        if (disposed) return;
        const reader = new BrowserQRCodeReader();
        return reader.decodeFromVideoDevice(
          undefined,
          video.current!,
          (result, _error, c) => {
            if (result && !disposed) {
              c.stop();
              setCamera(false);
              acceptRef.current(result.getText());
            }
          },
        );
      })
      .then((c) => {
        if (!c) return;
        if (disposed) c.stop();
        else controls.current = c;
      })
      .catch(() => {
        setError(
          "Camera unavailable. Allow camera permission or upload an image.",
        );
        setCamera(false);
      });
    return () => {
      disposed = true;
      controls.current?.stop();
      controls.current = null;
    };
  }, [camera]);
  async function image(file: File) {
    setError("");
    setProcessing(true);
    try {
      const { decodeQrImage } = await import("./qr-image");
      acceptRef.current(await decodeQrImage(file));
    } catch (error) {
      setError(errorText(error));
    } finally {
      setProcessing(false);
    }
  }
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) {
        e.preventDefault();
        void image(file);
      }
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  });
  const incoming = parts.length ? parts.flatMap((p) => p.accounts) : standard,
    skipped = parts.flatMap((p) => p.skipped),
    complete = !parts.length || parts.length === parts[0].batchSize;
  const seen = new Set(existing.map(duplicateKey));
  let duplicates = 0;
  for (const a of incoming) {
    const key = duplicateKey(a);
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return (
    <>
      <p>
        Scan, upload, or paste a QR image. Standard TOTP and Google
        Authenticator exports are supported.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="form-row">
        <button className="secondary" onClick={() => setCamera(!camera)}>
          {camera ? "Stop camera" : "Use camera"}
        </button>
        <label className="secondary file-button">
          Upload QR image
          <input
            aria-label="Upload QR image"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={processing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void image(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {camera && <video ref={video} muted playsInline className="camera" />}
      <Field label="Or paste an authenticator URI">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={100000}
          placeholder="otpauth://totp/… or otpauth-migration://offline?data=…"
          spellCheck={false}
        />
      </Field>
      <button
        className="secondary full"
        disabled={!text || processing}
        onClick={() => accept(text)}
      >
        Preview import
      </button>
      {(incoming.length > 0 || parts.length > 0) && (
        <section className="import-preview">
          <h3>
            {incoming.length} supported{" "}
            {incoming.length === 1 ? "account" : "accounts"}
          </h3>
          {parts.length > 0 && (
            <p>
              Batch: {parts.length} of {parts[0].batchSize} QR codes scanned.{" "}
              {!complete && "Scan every part before importing."}
            </p>
          )}
          <ul>
            {incoming.map((a, i) => (
              <li key={i}>
                {a.displayLabel} <span className="small">{a.accountName}</span>
              </li>
            ))}
          </ul>
          {duplicates > 0 && <p>{duplicates} duplicate(s) will be skipped.</p>}
          {skipped.map((s, i) => (
            <p className="warning" key={i}>
              {s}
            </p>
          ))}
          <button
            className="primary full"
            disabled={!complete || !incoming.length || busy}
            onClick={() =>
              void commit(incoming).catch((e) => report(errorText(e)))
            }
          >
            Import {incoming.length - duplicates} new accounts
          </button>
          <button
            className="text-button full"
            onClick={() => {
              setParts([]);
              setStandard([]);
              setError("");
            }}
          >
            Clear preview
          </button>
        </section>
      )}
      <p className="small">Images are decoded locally and never saved.</p>
    </>
  );
}
function RestoreForm({
  unlocked,
  busy,
  restore,
}: {
  unlocked: boolean;
  busy: boolean;
  restore: (f: File, p: string, r: boolean) => Promise<void>;
}) {
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        const f = new FormData(e.currentTarget),
          file = f.get("file") as File;
        if (!file.size || file.size > MAX_BACKUP) {
          setError("Choose a backup smaller than 4 MB.");
          return;
        }
        void restore(
          file,
          String(f.get("password")),
          f.get("mode") === "replace",
        );
      }}
    >
      <p>
        The backup is decrypted and validated before your vault changes.
        Duplicate accounts are skipped when merging.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Field label="Encrypted backup file">
        <input
          name="file"
          type="file"
          accept=".json,application/json"
          required
        />
      </Field>
      <Field label="Password used for this backup">
        <input
          name="password"
          type="password"
          autoComplete="off"
          required
          maxLength={1024}
        />
      </Field>
      {unlocked ? (
        <Field label="Restore mode">
          <select name="mode">
            <option value="merge">Merge with current accounts</option>
            <option value="replace">Replace all current accounts</option>
          </select>
        </Field>
      ) : (
        <p className="notice warning">
          Recovery replaces the locked local vault with this backup and its
          password.
        </p>
      )}
      <label className="check-label">
        <input type="checkbox" required />I understand that replacement removes
        the current local accounts.
      </label>
      <button className="primary full" disabled={busy}>
        {busy ? "Validating backup…" : "Validate & restore backup"}
      </button>
    </form>
  );
}
