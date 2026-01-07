function doGet(e) {
  const config = getSystemConfig();
  const params = e.parameter;

  // 1. Check if it's a session-based access (from token)
  if (params['token']) {
    const sessionData = getSession(params['token']);
    if (sessionData) {
      const idKey = sessionData.email.split('@')[0].trim();
      const results = fetchUserData(idKey, config);

      const template = HtmlService.createTemplateFromFile('profile');
      template.user = sessionData;
      template.results = results;
      template.token = params['token']; // IMPORTANT: Pass token back for subsequent refreshes
      template.SCHOOL_NAME = config.SCHOOL_NAME;
      template.PAGE_TITLE = config.PAGE_TITLE;

      return template.evaluate()
        .setTitle(config.PAGE_TITLE)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }
  }

  // 2. Check if it's a callback from OpenID
  if (params['openid.mode'] === 'id_res') {
    return handleCallback(params, config);
  }

  // 3. Otherwise, show the landing page
  const template = HtmlService.createTemplateFromFile('index');
  // Inject config into template
  template.SCHOOL_NAME = config.SCHOOL_NAME;
  template.PAGE_TITLE = config.PAGE_TITLE;
  template.LOGO_LEFT_BASE64 = getLogoBase64(config.LOGO_LEFT_ID);
  template.LOGO_RIGHT_BASE64 = getLogoBase64(config.LOGO_RIGHT_ID);

  template.scriptUrl = ScriptApp.getService().getUrl();
  template.loginUrl = getLoginUrl(config);

  return template.evaluate()
    .setTitle(config.SCHOOL_NAME + " " + config.PAGE_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Generate the OpenID Login URL
 */
function getLoginUrl(config) {
  if (!config) config = getSystemConfig();

  const scriptUrl = ScriptApp.getService().getUrl();

  if (!scriptUrl) {
    // Fallback for dev mode or error
    return "#";
  }

  const queryParams = {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": scriptUrl,
    "openid.realm": scriptUrl,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.ns.sreg": "http://openid.net/extensions/sreg/1.1",
    "openid.sreg.required": "fullname,email,language,country,postcode"
  };

  const queryString = Object.keys(queryParams)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(queryParams[k]))
    .join('&');

  return config.OPENID_ENDPOINT + "?" + queryString;
}

/**
 * Handle the response from OpenID Provider
 */
function handleCallback(params, config) {
  if (!config) config = getSystemConfig();

  const isValid = verifyAuthentication(params, config);

  if (!isValid) {
    return HtmlService.createHtmlOutput("<h3 style='color:red;'>驗證失敗：簽章無效</h3>");
  }

  const fullEmail = (params['openid.sreg.email'] || "").trim();
  const idKey = fullEmail ? fullEmail.split('@')[0].trim() : '';

  const userData = {
    name: params['openid.sreg.fullname'],
    email: fullEmail,
    studentInfo: params['openid.sreg.language'], // Class/Seat info usually
    school: params['openid.sreg.country'],       // School name
    id: params['openid.sreg.postcode']
  };

  // Access Control check
  if (config.SCHOOL_RESTRICTION.ENABLED && userData.school && userData.school.indexOf(config.SCHOOL_RESTRICTION.KEYWORD) === -1) {
    return HtmlService.createHtmlOutput(`
      <div style="font-family: 'PingFang TC', sans-serif; text-align: center; padding: 50px;">
        <h2 style="color: #ef4444;">存取受限</h2>
        <p>${config.SCHOOL_RESTRICTION.ERROR_MESSAGE}</p>
        <p>您目前登入的單位為：<strong>${userData.school}</strong></p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px auto; width: 50%;">
        <a href="${ScriptApp.getService().getUrl()}" style="color: #4f46e5; text-decoration: none; font-weight: bold;">← 返回登入頁面</a>
      </div>
    `).setTitle("存取受限");
  }

  // Create a session for subsequent refreshes
  const token = createSession(userData);

  // Show Profile directly instead of redirecting
  const results = fetchUserData(idKey, config);
  const template = HtmlService.createTemplateFromFile('profile');
  template.user = userData;
  template.results = results;
  template.token = token; // Pass token for client-side URL cleaning
  template.SCHOOL_NAME = config.SCHOOL_NAME;
  template.PAGE_TITLE = config.PAGE_TITLE;

  return template.evaluate()
    .setTitle(config.PAGE_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Get data from multiple Google Sheets
 * Returns an object: { "SheetName": { key1: val1, ... }, ... }
 */
function fetchUserData(idKey, config) {
  if (!config) config = getSystemConfig();
  const targetKey = String(idKey || "").trim().toLowerCase();
  const results = {};

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ss.getSheets();
    const excluded = config.EXCLUDED_SHEETS || [];

    sheets.forEach(sheet => {
      const sheetName = sheet.getName();
      // Skip excluded sheets
      if (excluded.includes(sheetName)) return;

      const data = sheet.getDataRange().getValues();
      if (data.length < 2) return; // Empty or only header

      const headers = data[0];

      // Find row with matching ID (assuming Column A is ID)
      for (let i = 1; i < data.length; i++) {
        const rowKey = String(data[i][0]).trim().toLowerCase();
        if (rowKey === targetKey) {
          const rowData = {};
          for (let j = 0; j < headers.length; j++) {
            if (headers[j]) {
              rowData[headers[j]] = data[i][j];
            }
          }
          results[sheetName] = rowData;
          break; // Found in this sheet, move to next sheet
        }
      }
    });

    Logger.log(`Successfully fetched data for ${idKey} from ${Object.keys(results).length} sheets.`);
    return Object.keys(results).length > 0 ? results : null;

  } catch (e) {
    Logger.log("查詢錯誤: " + e.message);
  }
  return null;
}

/**
 * Perform indirect verification
 */
function verifyAuthentication(params, config) {
  if (!config) config = getSystemConfig();

  const verifyParams = Object.assign({}, params);
  verifyParams['openid.mode'] = 'check_authentication';

  const options = {
    method: "post",
    payload: verifyParams,
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(config.OPENID_ENDPOINT, options);
  const content = response.getContentText();

  return content.indexOf("is_valid:true") !== -1;
}

/**
 * Helper to include HTML files
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Fetch Logo Base64 from Drive File ID with Caching
 */
function getLogoBase64(input) {
  if (!input) return "";

  // Auto-extract ID if a URL was provided
  const fileId = extractDriveId(String(input).trim());
  if (!fileId) {
    Logger.log("Could not extract Drive ID from input: " + input);
    return "";
  }
  Logger.log("Extracted File ID: " + fileId);

  const cache = CacheService.getScriptCache();
  const cacheKey = "LOGO_BASE64_" + fileId;
  const cached = cache.get(cacheKey);

  if (cached) return cached;

  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const base64 = Utilities.base64Encode(blob.getBytes());
    const mimeType = blob.getContentType();

    // Construct data URL
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // Cache for 6 hours (21600 seconds)
    // Note: Cache has size limits (100KB). Logos should be small.
    // If too large, cache.put might fail or be truncated.
    try {
      cache.put(cacheKey, dataUrl, 21600);
    } catch (e) {
      Logger.log("Logo too large to cache: " + e.message);
    }

    return dataUrl;
  } catch (e) {
    Logger.log("Error fetching logo: " + e.message);
    return ""; // Fallback to empty on error
  }
}

/**
 * Robustly extract Google Drive File ID from Various URL formats or raw ID
 */
function extractDriveId(input) {
  if (!input) return null;

  // 1. Try to match /file/d/ID/ (Standard Share Link)
  const matchD = input.match(/\/file\/d\/([a-zA-Z0-9_-]{25,})/);
  if (matchD && matchD[1]) return matchD[1];

  // 2. Try to match ?id=ID (Legacy / Export Links)
  const matchId = input.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
  if (matchId && matchId[1]) return matchId[1];

  // 3. Match pure ID (Usually 33 chars for modern Drive IDs, but can vary)
  // Check if it looks like a valid ID (alphanumeric, underscores, hyphens, min length)
  if (/^[a-zA-Z0-9_-]{25,}$/.test(input)) return input;

  return null;
}

/**
 * Session Management using CacheService
 */
function createSession(userData) {
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  // Store for 60 minutes (3600 seconds)
  cache.put("SESSION_" + token, JSON.stringify(userData), 3600);
  return token;
}

function getSession(token) {
  const cache = CacheService.getScriptCache();
  const data = cache.get("SESSION_" + token);
  return data ? JSON.parse(data) : null;
}
