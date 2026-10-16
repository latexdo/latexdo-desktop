import { ipcMain as electronIpcMain } from "electron";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";

const trustedRenderers = new WeakMap<WebContents, string>();

export function trustIpcRenderer(contents: WebContents, entryUrl: string): void {
  trustedRenderers.set(contents, entryUrl);
}

function trustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const expected = trustedRenderers.get(event.sender);
  if (
    !expected ||
    !event.senderFrame ||
    event.sender.isDestroyed() ||
    event.senderFrame !== event.sender.mainFrame
  )
    return false;
  try {
    const actualUrl = new URL(event.senderFrame.url);
    const expectedUrl = new URL(expected);
    // Custom Electron schemes have opaque origins, so compare their components.
    return (
      actualUrl.protocol === expectedUrl.protocol &&
      actualUrl.host === expectedUrl.host &&
      actualUrl.pathname === expectedUrl.pathname &&
      !actualUrl.username &&
      !actualUrl.password
    );
  } catch {
    return false;
  }
}

export const ipcMain = {
  handle(channel: string, listener: Parameters<IpcMain["handle"]>[1]): void {
    electronIpcMain.handle(channel, (event, ...args) => {
      if (!trustedSender(event)) throw new Error("Untrusted IPC sender.");
      return listener(event, ...args);
    });
  },
  on(channel: string, listener: Parameters<IpcMain["on"]>[1]): void {
    electronIpcMain.on(channel, (event, ...args) => {
      if (trustedSender(event)) listener(event, ...args);
    });
  },
};
