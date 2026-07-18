export default function MuteButton({ muted, onClick }) {
  return (
    <button type="button" className="secondary control-button" onClick={onClick}>
      {muted ? "🔇 Unmute" : "🎤 Mute"}
    </button>
  );
}
