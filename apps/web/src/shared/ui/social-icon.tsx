/** Compact brand marks used by vehicle contact links; the parent supplies its accessible name. */
export function SocialIcon({
  platform,
  size = 20,
}: {
  platform: 'telegram' | 'whatsapp';
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      {platform === 'telegram' ? (
        <path
          d="M21.5 3.5 18 20c-.25 1.17-.95 1.46-1.92.91l-5.3-3.9-2.56 2.46c-.28.28-.52.52-1.06.52l.38-5.42 9.86-8.91c.43-.38-.1-.6-.66-.22L4.55 13.1l-5.24-1.64c-1.14-.36-1.16-1.14.24-1.69L20.04 1.9c.95-.35 1.78.21 1.46 1.6Z"
          transform="translate(1 1) scale(.94)"
        />
      ) : (
        <path d="M20.5 3.5A11.9 11.9 0 0 0 1.8 17.8L.2 23.6l6-1.6A11.9 11.9 0 0 0 20.5 3.5Zm-8.4 18a9.8 9.8 0 0 1-5-1.4l-.4-.2-3.6 1 1-3.5-.3-.4a9.8 9.8 0 1 1 8.3 4.5Zm5.4-7.4-1.8-.9c-.3-.1-.5-.2-.7.2l-.8 1c-.1.2-.3.2-.6.1a8 8 0 0 1-3.7-3.2c-.2-.3 0-.4.1-.6l.6-.7c.1-.2.2-.3.1-.6L9.9 7c-.2-.5-.4-.4-.6-.4h-.6c-.2 0-.5.1-.7.3-.7.7-1 1.5-.9 2.4 0 1.4 1 2.7 1.1 2.9.1.2 2 3 4.9 4.2 2.4 1 2.9.8 3.4.8.6-.1 1.8-.8 2-1.5.2-.6.2-1.2.1-1.3-.1-.1-.3-.2-.6-.3Z" />
      )}
    </svg>
  );
}
