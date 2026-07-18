export default function ScreenShareButton({ active, onClick }) {
  return (
    <button type="button" className="secondary control-button" onClick={onClick}>
      {active ? "Stop Sharing" : "Share Screen"}
    </button>
  );
}
