export default function CameraButton({ off, onClick }) {
  return (
    <button type="button" className="secondary control-button" onClick={onClick}>
      {off ? "🚫📷 Camera Off" : "📷 Camera On"}
    </button>
  );
}
