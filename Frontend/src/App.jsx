import React, { useRef, useEffect, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import axios from "axios";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./App.css"; // same CSS as before

const App = () => {
  const [result, setResult] = useState("Scanning…");
  const [userInfo, setUserInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
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
    const uuid = decodedText.includes(":")
      ? decodedText.split(":")[1].trim()
      : decodedText;

    setIsLoading(true);
    setResult("");

    if (html5QrCodeRef.current && isScanningRef.current) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
        isScanningRef.current = false;
      } catch (err) {
        console.error(err);
      }
    }

    try {
      const response = await axios.post(
        "http://localhost:3000/api/qr/scan",
        { uuid }
      );

      if (response.status === 200) {
        setUserInfo(response.data.user);
        toast.success( response.data.message, {
          position: "top-right",
          autoClose: 3000,
        });
      }
    } catch (err) {
      console.error(err);
      if (err.response) {
        toast.error( err.response.data.error, {
          position: "top-right",
          autoClose: 4000,
        });
      } else {
        toast.error(" Could not connect to server", {
          position: "top-right",
          autoClose: 4000,
        });
      }
    } finally {
      setIsLoading(false);
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
        const backCamera = cameras.find(
          (cam) =>
            cam.label.toLowerCase().includes("back") ||
            cam.label.toLowerCase().includes("rear")
        );
        const cameraId = backCamera ? backCamera.id : cameras[0].id;

        await html5QrCodeRef.current.start(
          cameraId,
          { fps: 10, qrbox: 300 },
          onScanSuccess
        );

        isScanningRef.current = true;
        setResult("Scanning…");
        setUserInfo(null);
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
    <div className="scanner-container">
      <h1 className="title">KKS ONAM <br/>QR Code Scanner</h1>

      <div id={readerId} className="camera-box"></div>

      <div className="status">
        {isLoading ? (
          <>
            <div className="loader"></div>
            <p>Fetching details…</p>
          </>
        ) : (
          result && <p>{result}</p>
        )}
      </div>

      {userInfo && (
        <div className="user-card">
          <h3>Scanned User Details</h3>
          <p><strong>Name:</strong> {userInfo.name}</p>
          <p><strong>Email:</strong> {userInfo.email}</p>
          <p><strong>KKS ID:</strong> {userInfo.kks_id}</p>
          <p><strong>Count:</strong> {userInfo.count}</p>
        </div>
      )}

      <button className="restart-btn" onClick={handleRestart}>
        Scan Again
      </button>

      {/* Toast notifications container */}
      <ToastContainer theme="colored" />
    </div>
  );
};

export default App;
