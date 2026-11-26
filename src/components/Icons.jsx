export function MusicNoteIcon(props) {
  return (
    <svg
      width={props.size || 16}
      height={props.size || 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth || 2.3}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function QueueIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M3 12h12" />
      <path d="M3 18h12" />
      <path d="M19 13v6" />
      <path d="M16 16h6" />
    </svg>
  );
}

export function Equalizer() {
  return (
    <span class="eq" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function ThumbVoteIcon(props) {
  return (
    <svg
      classList={{ 'thumb-vote-down': props.down }}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M7 10v10M15 6.5 14 10h5.4a2 2 0 0 1 1.9 2.6l-2 6a2 2 0 0 1-1.9 1.4H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h3l4-6a2 2 0 0 1 3 2.5Z" />
    </svg>
  );
}

export function HistoryIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export function ChevronDownIcon(props) {
  return (
    <svg
      width={props.size || 15}
      height={props.size || 15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth || 2.1}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function CrownIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4 18h16l1.5-9.5-5.2 3.8L12 5l-4.3 7.3L2.5 8.5 4 18Zm0 2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1H4v1Z" />
    </svg>
  );
}

export function PlusIcon(props) {
  return (
    <svg
      width={props.size || 12}
      height={props.size || 12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth || 2.4}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function CheckIcon(props) {
  return (
    <svg
      width={props.size || 12}
      height={props.size || 12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth || 2.5}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
