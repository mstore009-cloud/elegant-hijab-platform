export type OneDriveConnectionStatus = {
  configured: boolean;
  state: "not_configured" | "ready" | "failed";
  message: string;
  checkedAt: number;
};

export type OneDriveFolderItem = {
  id: string;
  name: string;
  kind: "file" | "folder";
  webUrl?: string;
};

export interface OneDriveConnector {
  testConnection(): Promise<OneDriveConnectionStatus>;
  readProductFolder(reference: string): Promise<OneDriveFolderItem[]>;
}

/**
 * Explicit safe default. Nothing in products assumes OneDrive works until a
 * Microsoft Graph adapter replaces this connector after a real authorization test.
 */
export class NotConfiguredOneDriveConnector implements OneDriveConnector {
  async testConnection(): Promise<OneDriveConnectionStatus> {
    return {
      configured: false,
      state: "not_configured",
      message: "لم تُهيّأ مصادقة OneDrive بعد. استخدم الإدخال اليدوي حتى ينجح اختبار حساب ومجلد فعليين.",
      checkedAt: Date.now(),
    };
  }

  async readProductFolder(): Promise<OneDriveFolderItem[]> {
    throw new Error("موصل OneDrive غير مهيأ. لا يمكن قراءة أي مجلد قبل نجاح اختبار المصادقة.");
  }
}

export const oneDriveConnector: OneDriveConnector = new NotConfiguredOneDriveConnector();
