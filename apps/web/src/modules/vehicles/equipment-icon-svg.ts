/**
 * Local item SVG geometry extracted from the publicly rendered equipment rows of
 * https://www.kmotors.shop/en/catalog/42713792 on 2026-11-14.
 * 44 labelled rows share 34 distinct item glyphs. Only path/circle geometry and
 * fixed currentColor paint are retained; no HTML, classes, scripts or URLs render.
 * The neutral fallback reuses HD Auto's shared information glyph.
 */
export type EquipmentSvg = {
  fill: 'none' | 'currentColor';
  strokeWidth: number;
  paths: readonly string[];
  circles: readonly { cx: number; cy: number; r: number }[];
};

export const equipmentIconSvg = {
  "seat": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M4 11a2 2 0 0 1 2 2v1h12v-1a2 2 0 1 1 4 0v5a1 1 0 0 1 -1 1h-18a1 1 0 0 1 -1 -1v-5a2 2 0 0 1 2 -2z",
      "M4 11v-3a3 3 0 0 1 3 -3h10a3 3 0 0 1 3 3v3",
      "M12 5v9"
    ],
    "circles": []
  },
  "seat-heating": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 10.941c2.333 -3.308 .167 -7.823 -1 -8.941c0 3.395 -2.235 5.299 -3.667 6.706c-1.43 1.408 -2.333 3.621 -2.333 5.588c0 3.704 3.134 6.706 7 6.706s7 -3.002 7 -6.706c0 -1.712 -1.232 -4.403 -2.333 -5.588c-2.084 3.353 -3.257 3.353 -4.667 2.235"
    ],
    "circles": []
  },
  "climate": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M8 16a3 3 0 0 1 -3 3",
      "M16 16a3 3 0 0 0 3 3",
      "M12 16v4",
      "M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z",
      "M7 13v-3a1 1 0 0 1 1 -1h8a1 1 0 0 1 1 1v3"
    ],
    "circles": []
  },
  "steering-controls": {
    "fill": "currentColor",
    "strokeWidth": 0,
    "paths": [
      "M17 3.34a10 10 0 1 1 -15 8.66l.005 -.324a10 10 0 0 1 14.995 -8.336m-13 8.66a8 8 0 0 0 7 7.937v-5.107a3 3 0 0 1 -1.898 -2.05l-5.07 -1.504q -.031 .36 -.032 .725m15.967 -.725l-5.069 1.503a3 3 0 0 1 -1.897 2.051v5.108a8 8 0 0 0 6.985 -8.422zm-11.967 -6.204a8 8 0 0 0 -3.536 4.244l4.812 1.426a3 3 0 0 1 5.448 0l4.812 -1.426a8 8 0 0 0 -11.536 -4.244"
    ],
    "circles": []
  },
  "seat-ventilation": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 12v-9l4.912 1.914a1.7 1.7 0 0 1 .428 2.925z",
      "M14.424 15.03l-2.424 -3.03h6",
      "M12 12h-9l1.914 -4.912a1.7 1.7 0 0 1 2.925 -.428z",
      "M12 12v9l-4.912 -1.914a1.7 1.7 0 0 1 -.428 -2.925z",
      "M18 17l2 -2v6"
    ],
    "circles": []
  },
  "seat-memory": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4z"
    ],
    "circles": []
  },
  "cruise-control": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
      "M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
      "M13.41 10.59l2.59 -2.59",
      "M7 12a5 5 0 0 1 5 -5"
    ],
    "circles": []
  },
  "steering-wheel": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
      "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
      "M12 14l0 7",
      "M10 12l-6.75 -2",
      "M14 12l6.75 -2"
    ],
    "circles": []
  },
  "abs": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
      "M5.7 5.7l12.6 12.6"
    ],
    "circles": []
  },
  "driver-airbag": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06",
      "M15 19l2 2l4 -4"
    ],
    "circles": []
  },
  "passenger-airbag": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"
    ],
    "circles": []
  },
  "parking-sensors-rear": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
      "M15.51 15.56a5 5 0 1 0 -3.51 1.44",
      "M18.832 17.86a9 9 0 1 0 -6.832 3.14",
      "M12 12v9"
    ],
    "circles": []
  },
  "tire-pressure": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
      "M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
      "M3 12h6",
      "M15 12h6",
      "M13.6 9.4l3.4 -4.8",
      "M10.4 14.6l-3.4 4.8",
      "M7 4.6l3.4 4.8",
      "M13.6 14.6l3.4 4.8"
    ],
    "circles": []
  },
  "stability-control": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M3 12h4l3 8l4 -16l3 8h4"
    ],
    "circles": []
  },
  "curtain-airbag": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3",
      "M12 3v18",
      "M3.5 12h17"
    ],
    "circles": []
  },
  "camera": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2",
      "M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"
    ],
    "circles": []
  },
  "parking-sensors-front": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M21 12h-8a1 1 0 1 0 -1 1v8a9 9 0 0 0 9 -9",
      "M16 9a5 5 0 1 0 -7 7",
      "M20.486 9a9 9 0 1 0 -11.482 11.495"
    ],
    "circles": []
  },
  "blind-spot": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0",
      "M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"
    ],
    "circles": []
  },
  "lane-departure": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 9v4",
      "M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z",
      "M12 16h.01"
    ],
    "circles": []
  },
  "parking-brake": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14z",
      "M10 16v-8h2.667c.736 0 1.333 .895 1.333 2s-.597 2 -1.333 2h-2.667"
    ],
    "circles": []
  },
  "monitor": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M21 12v3a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10a1 1 0 0 1 1 -1h9",
      "M7 20l10 0",
      "M9 16l0 4",
      "M15 16l0 4",
      "M17 4h4v4",
      "M16 9l5 -5"
    ],
    "circles": []
  },
  "navigation": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 18.5l7.265 2.463c.196 .077 .42 .032 .57 -.116a.548 .548 0 0 0 .134 -.572l-7.969 -17.275l-7.97 17.275c-.07 .2 -.017 .424 .135 .572c.15 .148 .374 .193 .57 .116l7.265 -2.463"
    ],
    "circles": []
  },
  "usb": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
      "M12 17v-11.5",
      "M7 10v3l5 3",
      "M12 14.5l5 -2v-2.5",
      "M16 10h2v-2h-2z",
      "M7 9m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
      "M10 5.5h4l-2 -2.5z"
    ],
    "circles": []
  },
  "keyless-entry": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M11 20a3 3 0 0 1 -3 -3v-11l5 5",
      "M13 4a3 3 0 0 1 3 3v11l-5 -5",
      "M4 4m0 3a3 3 0 0 1 3 -3h10a3 3 0 0 1 3 3v10a3 3 0 0 1 -3 3h-10a3 3 0 0 1 -3 -3z"
    ],
    "circles": []
  },
  "bluetooth": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M7 8l10 8l-5 4l0 -16l5 4l-10 8"
    ],
    "circles": []
  },
  "door-lock": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z",
      "M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0",
      "M8 11v-4a4 4 0 1 1 8 0v4"
    ],
    "circles": []
  },
  "window": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 3c-3.866 0 -7 3.272 -7 7v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1 -1v-10c0 -3.728 -3.134 -7 -7 -7z",
      "M5 13l14 0",
      "M12 3l0 18"
    ],
    "circles": []
  },
  "side-airbag": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3",
      "M12 3v18"
    ],
    "circles": []
  },
  "mirror-folding": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M3 7V5a2 2 0 0 1 2-2h2",
      "M17 3h2a2 2 0 0 1 2 2v2",
      "M21 17v2a2 2 0 0 1-2 2h-2",
      "M7 21H5a2 2 0 0 1-2-2v-2",
      "M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"
    ],
    "circles": [
      {
        "cx": 12.0,
        "cy": 12.0,
        "r": 1.0
      }
    ]
  },
  "headlight-hid": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7",
      "M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3",
      "M9.7 17l4.6 0"
    ],
    "circles": []
  },
  "mirror-dimming": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
    ],
    "circles": []
  },
  "smart-key": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M16.555 3.843l3.602 3.602a2.877 2.877 0 0 1 0 4.069l-2.643 2.643a2.877 2.877 0 0 1 -4.069 0l-.301 -.301l-6.558 6.558a2 2 0 0 1 -1.239 .578l-.175 .008h-1.172a1 1 0 0 1 -.993 -.883l-.007 -.117v-1.172a2 2 0 0 1 .467 -1.284l.119 -.13l.414 -.414h2v-2h2v-2l2.144 -2.144l-.301 -.301a2.877 2.877 0 0 1 0 -4.069l2.643 -2.643a2.877 2.877 0 0 1 4.069 0z",
      "M15 9h.01"
    ],
    "circles": []
  },
  "rain-sensor": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M12 20m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
      "M3 11l5.5 5.5a5 5 0 0 1 7 0l5.5 -5.5a12 12 0 0 0 -18 0",
      "M12 20l0 -14",
      "M4 6a4 4 0 0 1 .4 -1.8",
      "M7 2.1a4 4 0 0 1 2 0",
      "M12 6a4 4 0 0 0 -.4 -1.8",
      "M12 6a4 4 0 0 1 .4 -1.8",
      "M15 2.1a4 4 0 0 1 2 0",
      "M20 6a4 4 0 0 0 -.4 -1.8"
    ],
    "circles": []
  },
  "automatic-headlights": {
    "fill": "none",
    "strokeWidth": 2,
    "paths": [
      "M14.828 14.828a4 4 0 1 0 -5.656 -5.656a4 4 0 0 0 5.656 5.656z",
      "M6.343 17.657l-1.414 1.414",
      "M6.343 6.343l-1.414 -1.414",
      "M17.657 6.343l1.414 -1.414",
      "M17.657 17.657l1.414 1.414",
      "M4 12h-2",
      "M12 4v-2",
      "M20 12h2",
      "M12 20v2"
    ],
    "circles": []
  },
  "neutral": {
    "fill": "none",
    "strokeWidth": 1.6,
    "paths": [
      "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10v1"
    ],
    "circles": []
  }
} as const satisfies Record<string, EquipmentSvg>;

export type EquipmentIconName = keyof typeof equipmentIconSvg;
