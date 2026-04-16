/** Samsara-style activity type SVG icons */

interface IconProps {
  size?: number;
  className?: string;
}

/** Driving — steering wheel icon (from Samsara) */
export function IconDriving({ size = 14, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor">
      <path d="M7.77054 2H8.5952C9.62602 2.95803 10.6754 3.88899 11.6732 4.87618C12.5659 5.75924 12.5494 6.56524 11.6382 7.46496C11.1599 7.93773 10.1311 8.71457 10.1311 8.71457L12.2711 11.0055C13.2112 10.01 14.141 9.09778 14.9739 8.10643C15.333 7.68337 15.5685 7.1678 15.6543 6.6173C15.8996 4.6096 17.5592 3.31001 19.3652 3.85983C19.1446 4.10143 18.9529 4.33052 18.7323 4.54504C17.2727 6.03416 17.2891 6.00292 18.7612 7.48579C19.3487 8.07727 19.792 8.1335 20.3775 7.50661C20.8579 6.99844 21.4557 6.60273 22 6.15703V7.40664C21.3341 8.94783 20.3321 10.0017 18.4952 9.88087C18.3257 9.87624 18.1608 9.9365 18.0334 10.0496C16.9242 11.1596 15.8295 12.2864 14.5801 13.5589L21.7526 20.69L20.3486 22L13.0807 15.0921C12.2474 15.9253 11.8793 16.1004 10.9723 17.0807C9.43766 18.7393 8.27289 19.8361 6.89022 21.1815C6.56485 21.5226 6.11886 21.7194 5.65006 21.7288C5.18126 21.7381 4.72791 21.5593 4.38944 21.2315C3.70498 20.5463 3.79338 19.681 4.50052 18.875C4.77266 18.5647 6.4985 17.2259 6.4985 17.2259L10.8281 13.1874L8.5952 10.688L8.13751 10.9993C8.13751 10.9993 7.61385 11.547 7.33347 11.8011C6.54798 12.5092 5.77693 12.5738 5.04711 11.8594C3.99155 10.8181 3.01227 9.71842 2 8.64376V7.81068L7.77054 2ZM5.65006 20.75C6.37592 20.75 6.4985 20.2478 6.4985 19.9527C6.4985 19.3018 6.0367 19.1301 5.75219 19.1092C5.46768 19.0884 5.01234 19.3599 4.91722 19.8569C4.85744 20.1693 5.19884 20.75 5.65006 20.75Z" />
    </svg>
  );
}

/** Work — wrench/hammer icon */
export function IconWork({ size = 14, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor">
      <path d="M15.73 3.27a5.5 5.5 0 0 1 .955 6.32l-.147.262 4.892 4.893a2 2 0 0 1-2.7 2.945l-.128-.117-4.893-4.893-.262.148a5.5 5.5 0 0 1-7.226-7.226l3.536 3.536 2.121-2.121-3.536-3.536a5.5 5.5 0 0 1 6.32.955l.069.073-.069-.073zM5.5 13l-2.207 2.293a1 1 0 0 0-.083 1.32l.083.094 4 4a1 1 0 0 0 1.32.083l.094-.083L11 18.5 5.5 13z" />
    </svg>
  );
}

/** Rest — bed/sleep icon */
export function IconRest({ size = 14, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor">
      <path d="M3 12h2v7H3v-7zm16-4h-8a2 2 0 0 0-2 2v4h12v-4a2 2 0 0 0-2-2zM7 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM3 21h18v-2H3v2z" />
    </svg>
  );
}

/** Availability — clock/timer icon */
export function IconAvailability({ size = 14, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z" />
    </svg>
  );
}

/** Unknown — question mark icon */
export function IconUnknown({ size = 14, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
    </svg>
  );
}

/** Get the icon component for a given activity type */
export const ACTIVITY_ICONS: Record<string, (props: IconProps) => JSX.Element> = {
  DRIVING: IconDriving,
  WORK: IconWork,
  REST: IconRest,
  AVAILABILITY: IconAvailability,
  UNKNOWN: IconUnknown,
};
