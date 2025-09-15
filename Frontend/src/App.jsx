import React, { useRef, useEffect, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import axios from "axios"; // import axios

const App = () => {
  const [result, setResult] = useState("Scanned text will appear here.");
  const isScanningRef = useRef(false);
  const html5QrCodeRef = useRef(null);
  const readerId = "reader";

  useEffect(() => {
    startScanner();
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line
  }, []);

const onScanSuccess = async (decodedText) => {
  // If your scanned text is like "UUID:98293712937"
  // extract only the UUID after the colon
  const uuid = decodedText.includes(":") ? decodedText.split(":")[1].trim() : decodedText;

  setResult(uuid); // show only the UUID

  if (html5QrCodeRef.current && isScanningRef.current) {
    try {
      await html5QrCodeRef.current.stop();
      html5QrCodeRef.current.clear();
      isScanningRef.current = false;
    } catch (err) {
      console.error(err);
    }
  }

  // Send only the UUID to backend
  try {
    const response = await axios.post("https://kks-qr.onrender.com/api/qr/scan", {
      uuid: uuid, // <-- only UUID
    });

    alert(response.status === 200 ? "✅ " + response.data.message : "❌ Error: " + response.data.message);
  } catch (err) {
    console.error(err);
    if (err.response) {
      alert("❌ Error: " + err.response.data.message);
    } else {
      alert("❌ Could not connect to server");
    }
  }
};


 const startScanner = async () => {
  if (!html5QrCodeRef.current) {
    html5QrCodeRef.current = new Html5Qrcode(readerId);
  }

  if (isScanningRef.current) return;

  try {
    const cameras = await Html5Qrcode.getCameras();
    if (cameras && cameras.length) {
      // Try to select the back camera
      const backCamera = cameras.find(cam => 
        cam.label.toLowerCase().includes("back") || cam.label.toLowerCase().includes("rear")
      );

      const cameraId = backCamera ? backCamera.id : cameras[0].id;

      await html5QrCodeRef.current.start(
        cameraId,
        { fps: 10, qrbox: 250 },
        onScanSuccess
      );

      isScanningRef.current = true;
      setResult("Scanning…");
    } else {
      setResult("No camera found.");
    }
  } catch (err) {
    setResult("Camera error: " + err);
  }
};


  const stopScanner = async () => {
    if (html5QrCodeRef.current && isScanningRef.current) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
        isScanningRef.current = false;
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleRestart = async () => {
    await stopScanner();
    startScanner();
  };

  return (
    <div style={{ fontFamily: "Arial, sans-serif", textAlign: "center", padding: 20, background: "#f9f9f9" }}>
      <h1 style={{ color: "#333" }}>QR Code Scanner</h1>
      <div id={readerId} style={{ width: 320, margin: "20px auto" }}></div>
      <div style={{ marginTop: 20, fontSize: "1.2rem", color: "#007700", wordBreak: "break-all" }}>
        {result}
      </div>
      <button
        onClick={handleRestart}
        style={{ marginTop: 15, padding: "8px 16px", fontSize: "1rem" }}
      >
        Scan Again
      </button>
    </div>
  );
};

export default App;
