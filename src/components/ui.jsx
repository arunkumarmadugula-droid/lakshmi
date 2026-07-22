import {
  Archive,
  ArrowDownLeft,
  Banknote,
  Bell,
  CalendarDays,
  Camera,
  Car,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Cloud,
  Coffee,
  Copy,
  CreditCard,
  Database,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Fingerprint,
  FileText,
  FileSpreadsheet,
  Fuel,
  Gauge,
  HardDrive,
  Home,
  Image,
  KeyRound,
  LayoutDashboard,
  List,
  Link2,
  Lock,
  LogOut,
  MapPin,
  Menu,
  MoreHorizontal,
  PiggyBank,
  Plus,
  ReceiptText,
  RotateCcw,
  RefreshCw,
  Save,
  Scale,
  ScanFace,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";

const ICONS = {
  archive: Archive,
  "arrow-down-left": ArrowDownLeft,
  banknote: Banknote,
  bell: Bell,
  calendar: CalendarDays,
  camera: Camera,
  car: Car,
  check: Check,
  "chevron-down": ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
  clipboard: Clipboard,
  cloud: Cloud,
  coffee: Coffee,
  copy: Copy,
  card: CreditCard,
  database: Database,
  download: Download,
  edit: Edit3,
  eye: Eye,
  "eye-off": EyeOff,
  fingerprint: Fingerprint,
  file: FileText,
  spreadsheet: FileSpreadsheet,
  fuel: Fuel,
  gauge: Gauge,
  drive: HardDrive,
  home: Home,
  image: Image,
  key: KeyRound,
  board: LayoutDashboard,
  list: List,
  link: Link2,
  lock: Lock,
  logout: LogOut,
  map: MapPin,
  menu: Menu,
  more: MoreHorizontal,
  savings: PiggyBank,
  plus: Plus,
  ledger: ReceiptText,
  restore: RotateCcw,
  sync: RefreshCw,
  save: Save,
  prices: Scale,
  face: ScanFace,
  search: Search,
  settings: Settings,
  share: Share2,
  shield: ShieldCheck,
  ai: Sparkles,
  trash: Trash2,
  upload: Upload,
  user: UserRound,
  users: UsersRound,
  budget: WalletCards,
  x: X,
};

export function Icon({ name, size = 16, strokeWidth = 1.8, ...props }) {
  const Component = ICONS[name] || MoreHorizontal;
  return <Component size={size} strokeWidth={strokeWidth} aria-hidden="true" {...props} />;
}

export function LotusLogo() {
  return (
    <span className="lotus-mark" role="img" aria-label="Lakshmi prosperity lotus">
      <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <g stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M32 47C23 39 22 26 32 11c10 15 9 28 0 36Z" />
          <path d="M30 48C19 47 12 39 10 27c11 1 19 7 22 18" />
          <path d="M34 48c11-1 18-9 20-21-11 1-19 7-22 18" />
          <path d="M16 54c10 3 22 3 32 0" />
        </g>
      </svg>
    </span>
  );
}

export function Button({ children, kind = "", compact = false, className = "", ...props }) {
  return <button type="button" className={`button ${kind} ${compact ? "compact" : ""} ${className}`.trim()} {...props}>{children}</button>;
}

export function IconButton({ icon, label, className = "", ...props }) {
  return <button type="button" className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}><Icon name={icon} /></button>;
}

export function Card({ children, className = "", ...props }) {
  return <section className={`card ${className}`.trim()} {...props}>{children}</section>;
}

export function CardHeader({ label, title, helper, action, noMargin = false }) {
  return (
    <div className={`card-header ${noMargin ? "no-margin" : ""}`}>
      <div>
        {label && <div className="label">{label}</div>}
        {title && <div className="title">{title}</div>}
        {helper && <div className="helper">{helper}</div>}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, children, className = "" }) {
  return <label className={`field ${className}`.trim()}><span>{label}</span>{children}</label>;
}

export function Input({ className = "", onFocus, onBlur, onChange, value, ...props }) {
  const numeric = props.type === "number" || props.inputMode === "numeric" || props.inputMode === "decimal";
  function focus(event) {
    if (numeric && onChange && /^0(?:\.0+)?$/.test(String(value ?? "").trim())) {
      event.target.value = "";
      onChange(event);
    }
    onFocus?.(event);
  }
  function blur(event) {
    if (numeric && onChange && !String(event.target.value).trim()) {
      event.target.value = "0";
      onChange(event);
    }
    onBlur?.(event);
  }
  return <input className={`input ${className}`.trim()} value={value} onChange={onChange} onFocus={focus} onBlur={blur} {...props} />;
}

export function Select({ className = "", children, ...props }) {
  return <select className={`input ${className}`.trim()} {...props}>{children}</select>;
}

export function Textarea({ className = "", ...props }) {
  return <textarea className={`input ${className}`.trim()} {...props} />;
}

export function Segmented({ options, value, onChange, label, columns }) {
  return (
    <div className={`segmented ${columns === 2 ? "two" : ""}`} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="tab" aria-selected={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, label, onClose, children }) {
  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <CardHeader label={label} title={title} action={<IconButton icon="x" label="Close" onClick={onClose} />} />
        {children}
      </section>
    </div>
  );
}

export function EmptyState({ icon, title, helper, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon name={icon} size={20} /></span>
      <div><div className="title">{title}</div>{helper && <div className="helper">{helper}</div>}</div>
      {action}
    </div>
  );
}

export function MonthNavigator({ label, onPrevious, onNext, previousLabel = "Previous month", nextLabel = "Next month", action }) {
  return (
    <div className="month-nav">
      <IconButton icon="left" label={previousLabel} onClick={onPrevious} disabled={!onPrevious} />
      <div className="month-title">{label}</div>
      <IconButton icon="right" label={nextLabel} onClick={onNext} disabled={!onNext} />
      {action || <span />}
    </div>
  );
}

export function FileButton({ children, accept, capture, onFile, kind = "", disabled }) {
  return (
    <label className={`button file-label ${kind}`.trim()}>
      {children}
      <input
        className="file-input"
        type="file"
        accept={accept}
        capture={capture}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </label>
  );
}
