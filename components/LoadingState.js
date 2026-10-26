export default function LoadingState({label='loading',className=''}) {
 return <div className={`loading-state ${className}`} role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true"/><span>{label}</span></div>;
}
