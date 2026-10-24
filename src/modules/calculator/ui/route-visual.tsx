export function RouteVisual() {
  return (
    <div className="route-visual" aria-hidden="true">
      <svg viewBox="0 0 360 190" fill="none">
        <g stroke="currentColor" opacity=".22">
          <ellipse cx="195" cy="100" rx="118" ry="78" />
          <ellipse cx="195" cy="100" rx="70" ry="78" />
          <ellipse cx="195" cy="100" rx="25" ry="78" />
          <path d="M77 100h236M89 65h212M89 135h212M119 38h152M119 162h152" />
        </g>
        <path
          d="M247 118C203 11 108 19 95 81"
          stroke="url(#route-color)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <circle cx="247" cy="118" r="5" fill="#f35249" />
        <circle cx="247" cy="118" r="13" stroke="#f35249" opacity=".25" />
        <circle cx="95" cy="81" r="4" fill="#e5e5e5" />
        <text x="263" y="122" fill="#e2e2e2" fontSize="12" fontFamily="sans-serif">
          CN
        </text>
        <text x="64" y="85" fill="#aaa" fontSize="12" fontFamily="sans-serif">
          WORLD
        </text>
        <defs>
          <linearGradient id="route-color">
            <stop stopColor="#f35249" />
            <stop offset="1" stopColor="#f35249" stopOpacity=".1" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}
