/**
 * Config.js
 * Handles reading configuration from the '系統設定' (System Config) sheet.
 */

const CONFIG_SHEET_NAME = "環境設定";
const DEFAULT_CONFIG = {
    SCHOOL_NAME: "測試學校",
    LOGO_LEFT_ID: "",   // 左側 Logo
    LOGO_RIGHT_ID: "",  // 右側 Logo
    PAGE_TITLE: "查詢系統",
    EXCLUDED_SHEETS: ["環境設定", "Log", "Draft", "Sheet1"] // Default ignored sheets
};

/**
 * Reads settings from the spreadsheet.
 */
function getSystemConfig() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG_SHEET_NAME);

    let config = { ...DEFAULT_CONFIG };

    if (sheet) {
        const data = sheet.getDataRange().getValues();
        data.forEach(row => {
            const key = String(row[0]).trim();
            const value = row[1];

            if (key === "學校名稱") config.SCHOOL_NAME = value;
            if (key === "網站標題") config.PAGE_TITLE = value;
            if (key === "左側Logo連結" || key === "左側Logo檔案ID") config.LOGO_LEFT_ID = value;
            if (key === "右側Logo連結" || key === "右側Logo檔案ID") config.LOGO_RIGHT_ID = value;
            if (key === "排除工作表") {
                if (value) {
                    const extraExcludes = String(value).split(',').map(s => s.trim());
                    config.EXCLUDED_SHEETS = [...new Set([...config.EXCLUDED_SHEETS, ...extraExcludes])];
                }
            }
        });
    } else {
        console.warn(`Warning: Config sheet '${CONFIG_SHEET_NAME}' not found.`);
    }

    // Inject System Constants
    config.OPENID_ENDPOINT = "https://openid.ntpc.edu.tw/OpenId/Provider";
    config.SCHOOL_RESTRICTION = {
        ENABLED: true,
        KEYWORD: config.SCHOOL_NAME,
        ERROR_MESSAGE: "本系統僅限本校教職員使用。"
    };

    return config;
}
