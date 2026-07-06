import { useCallback } from "react";

export function sendChromeMessage<T>(msg: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response as T);
    });
  });
}

export function useChromeMessage() {
  const send = useCallback(<T>(msg: object) => sendChromeMessage<T>(msg), []);
  return { send };
}
