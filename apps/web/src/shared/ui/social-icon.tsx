const marks = {
  telegram: (
    <path
      d="M21.5 3.5 18 20c-.25 1.17-.95 1.46-1.92.91l-5.3-3.9-2.56 2.46c-.28.28-.52.52-1.06.52l.38-5.42 9.86-8.91c.43-.38-.1-.6-.66-.22L4.55 13.1l-5.24-1.64c-1.14-.36-1.16-1.14.24-1.69L20.04 1.9c.95-.35 1.78.21 1.46 1.6Z"
      transform="translate(1 1) scale(.94)"
    />
  ),
  whatsapp: (
    <path d="M20.5 3.5A11.9 11.9 0 0 0 1.8 17.8L.2 23.6l6-1.6A11.9 11.9 0 0 0 20.5 3.5Zm-8.4 18a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.6 1 1-3.5-.3-.4a9.8 9.8 0 1 1 8.3 4.5Zm5.4-7.4-1.8-.9c-.3-.1-.5-.2-.7.2l-.8 1c-.1.2-.3.2-.6.1a8 8 0 0 1-3.7-3.2c-.2-.3 0-.4.1-.6l.6-.7c.1-.2.2-.3.1-.6L9.9 7c-.2-.5-.4-.4-.6-.4h-.6c-.2 0-.5.1-.7.3-.7.7-1 1.5-.9 2.4 0 1.4 1 2.7 1.1 2.9.1.2 2 3 4.9 4.2 2.4 1 2.9.8 3.4.8.6-.1 1.8-.8 2-1.5.2-.6.2-1.2.1-1.3-.1-.1-.3-.2-.6-.3Z" />
  ),
  facebook: (
    <path d="M14 22v-9h3l.5-3.5H14V7.3c0-1 .3-1.8 1.8-1.8H18V2.4a25 25 0 0 0-2.8-.2c-2.9 0-4.8 1.7-4.8 4.9v2.4H7V13h3.4v9Z" />
  ),
  instagram: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.8" r=".85" fill="currentColor" stroke="none" />
    </g>
  ),
  tiktok: (
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.57-4.08v-.29h-3.1v13.44a2.59 2.59 0 1 1-1.85-2.48V9.99a5.64 5.64 0 1 0 5.36 5.64V8.69a8.16 8.16 0 0 0 4.1 1.13V6.72a4.85 4.85 0 0 1-.94-.03Z" />
  ),
  wechat: (
    <>
      <path d="M15.5 8.3C14.8 5.2 11.9 3 8.5 3 4.4 3 1 5.8 1 9.3c0 1.9 1 3.6 2.6 4.8L3 16.7l2.8-1.4c.7.2 1.5.3 2.2.4m14.9-.9c0 1.6-.8 3-2.2 4l.5 2.1-2.3-1.1c-.7.2-1.4.3-2.1.3-3.5 0-6.3-2.4-6.3-5.3s2.8-5.3 6.3-5.3 6.1 2.4 6.1 5.3Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="6" cy="8.5" r=".85" />
      <circle cx="10.4" cy="8.5" r=".85" />
      <circle cx="14.7" cy="14" r=".8" />
      <circle cx="18.6" cy="14" r=".8" />
    </>
  ),
};

/** Platform marks are decorative. The parent supplies the accessible name. */
export function SocialIcon({
  platform,
  size = 20,
}: {
  platform: keyof typeof marks;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      {marks[platform]}
    </svg>
  );
}
