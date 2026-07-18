import { formatFileSize } from "../hooks/useChat.js";

function getFileIcon(message) {
  const type = message.fileType ?? "";
  const name = message.fileName ?? "file";

  if (type.startsWith("image/")) {
    return "IMG";
  }

  if (type === "application/pdf") {
    return "PDF";
  }

  if (type.includes("word") || name.endsWith(".doc") || name.endsWith(".docx")) {
    return "DOC";
  }

  if (name.endsWith(".zip") || name.endsWith(".rar") || name.endsWith(".7z")) {
    return "ZIP";
  }

  if (name.endsWith(".txt")) {
    return "TXT";
  }

  return "FILE";
}

export default function FileMessage({ message }) {
  const isImage = (message.fileType ?? "").startsWith("image/");
  const previewUrl = message.previewUrl || message.fileUrl;
  const icon = getFileIcon(message);

  return (
    <div className="file-message">
      {isImage && previewUrl ? (
        <a className="file-preview" href={message.fileUrl} download={message.fileName}>
          <img src={previewUrl} alt={message.fileName} />
        </a>
      ) : (
        <div className="file-icon" aria-hidden="true">
          {icon}
        </div>
      )}

      <div className="file-details">
        <p className="file-name">{message.fileName}</p>
        <p className="file-meta">
          {formatFileSize(message.fileSize)}
          {message.status ? ` • ${message.status}` : ""}
        </p>
        <div className="file-actions">
          {message.fileUrl ? (
            <a className="file-download" href={message.fileUrl} download={message.fileName}>
              Download
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
