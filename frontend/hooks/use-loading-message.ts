import { useState, useEffect } from 'react';

const MESSAGES = [
  "Tracing the piping...",
  "Consulting the P&ID...",
  "Cross-checking the logbook...",
  "Walking the process line...",
  "Reading the nameplate...",
  "Pulling maintenance records...",
  "Verifying the interlocks...",
  "Scanning the control room...",
  "Following the signal path...",
  "Checking the manifold...",
  "Reviewing safety data sheets...",
  "Inspecting the flange...",
  "Analyzing stress points...",
  "Calculating flow rates...",
  "Checking calibration logs...",
  "Reviewing maintenance history...",
  "Locating instrument tags...",
  "Checking pressure differentials...",
  "Aligning pump shafts...",
  "Inspecting valve stems..."
];

export function useLoadingMessage(isLoading: boolean, defaultMessage: string = "Connecting to industrial copilot...") {
  const [message, setMessage] = useState(defaultMessage);

  useEffect(() => {
    if (!isLoading) {
      setMessage(defaultMessage);
      return;
    }

    // Start with a random message immediately
    setMessage(MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);

    // Rotate every 2 seconds
    const interval = setInterval(() => {
      setMessage(MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);
    }, 2000);

    return () => clearInterval(interval);
  }, [isLoading, defaultMessage]);

  return message;
}
