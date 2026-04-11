/* =====================================================
   ai.js — Gemini AI Smart Assistant
   Expense Claim Manager — LL Station
   ===================================================== */

const AI = {
    apiKey: localStorage.getItem('ec_gemini_key') || '',
    API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',

    setApiKey(key) {
        this.apiKey = key;
        localStorage.setItem('ec_gemini_key', key);
    },

    async analyze(input, type) {
        if (!this.apiKey) {
            return {
                desc: '', amount: null, currency: 'HKD',
                date: new Date().toISOString().split('T')[0],
                payment: '其他', suggestions: [],
                error: '請先設定 Gemini API Key'
            };
        }

        const today = new Date().toISOString().split('T')[0];

        const systemPrompt = `你係一個專業嘅報銷管理助手，識得廣東話。你要好聰明咁分析收據，唔係淨係提取資料，仲要主動發現問題同提醒用戶。

請返回以下 JSON 格式（只返回 JSON，唔好有其他文字）：
{
  "desc": "費用描述（繁體中文，廣東話風格，要具體！）",
  "amount": 數字（只係數字，唔好有貨幣符號）,
  "currency": "HKD 或 RMB",
  "date": "YYYY-MM-DD 格式日期",
  "payment": "付款方式",
  "suggestions": [{ "label": "建議文字", "field": "exp-desc 或 exp-amount 或 exp-date 或 exp-payment 或 exp-currency", "value": "建議值" }],
  "error": null 或 "錯誤訊息",
  "message": null 或 "給用戶嘅提示訊息（重要：有疑問一定要寫喺呢度）"
}

=== 智能分析規則（最重要！）===

📌 描述要具體，唔好太 generic：
- 銀行轉帳/FPS/轉數快/網上轉帳/ATM轉帳 → 呢類單據通常冇寫明用途！你一定要喺 message 問：「呢筆轉帳係用嚟做咩㗎？例如：交租、還錢、買嘢付款？請補充用途方便報銷分類」。desc 暫時寫「轉帳 - 待補充用途」，唔好當普通消費咁寫
- 超市/便利店收據 → 睇清楚買咗咩，desc 要寫主要物品，唔好寫「超市購物」
- 外賣平台 → 要寫餐廳名，唔好淨係寫「外賣」
- 如果真係睇唔清楚用途 → message 一定要問用戶補充
- 任何冇明確消費目的嘅交易（轉帳、匯款、過數）→ message 必問用途

📌 日期處理（今日係 ${today}）：
- 最重要：如果收據/截圖上面完全搵唔到日期 → date 設為 null，message 一定要寫：「呢張單上面搵唔到日期，請你手動輸入正確日期」。絕對唔好靜雞雞用今日日期填上去！
- 如果收據日期同今日相差超過 30 日 → message 要提醒：「呢張單係 [日期] 嘅，距離而家已經 [X] 日，係咪而家先入？遲咗報銷可能有問題喎」
- 如果收據日期同今日相差超過 180 日 → message 要強調：「⚠️ 呢張單已經超過半年（[日期]），確定要報銷？建議盡快處理」
- 如果收據日期係未來日期 → message 要問：「呢個日期好似係未來嘅喎，係咪搞錯咗？」

📌 金額異常檢測（要準確，唔好亂報 warning！）：
- 只有金額真正超過 2000 先提示，$500、$800、$1999 呢啲完全正常，唔好提示！
- 金額 >= 5000 嘅整數轉帳 → 可能係轉帳唔係消費，message 要問清楚
- 金額 = 0 或者好細（< $1）→ message 問係咪正確
- 普通消費金額（幾十到幾千蚊）完全正常，唔需要任何 warning

=== 基本提取規則 ===
1. payment 必須係以下其中一個：現金、信用卡、淘寶、拼多多、轉數快、支付寶、其他
2. currency 只能係 HKD 或 RMB
3. 如果係淘寶截圖或有淘寶字樣 → currency 建議 RMB，payment 建議 淘寶
4. 如果係拼多多截圖或有拼多多字樣 → currency 建議 RMB，payment 建議 拼多多
5. 如果有 ¥ 符號或人民幣 → currency = RMB
6. 如果有 $ 符號（香港情況）→ currency = HKD
7. 如果搵唔到金額 → error 寫明叫用戶手動輸入，amount 設為 null
8. 如果搵唔到日期 → date 設為 null（唔好用今日日期！），message 提醒用戶手動填
9. 如果收據有多項費用 → suggestions 入面建議分開記錄或合併
10. 文字輸入例如「五金鋪雜項 $46」→ desc="五金鋪雜項"，amount=46，currency=HKD
11. 文字輸入例如「淘寶買咗枕頭 ¥89」→ desc="淘寶買枕頭"，amount=89，currency=RMB，payment=淘寶
12. 所有回覆用繁體中文（廣東話風格）
13. desc 唔好太長但要具體，「銀行轉帳」呢種太 generic 唔收貨`;

        let parts;

        if (type === 'photo') {
            const base64Data = input.split(',')[1];
            const mimeType = input.split(';')[0].split(':')[1];
            parts = [
                { text: systemPrompt },
                { inlineData: { mimeType, data: base64Data } },
                { text: '請分析呢張收據' }
            ];
        } else {
            parts = [
                { text: systemPrompt },
                { text: `用戶輸入：「${input}」` }
            ];
        }

        try {
            const response = await fetch(`${this.API_URL}?key=${this.apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        temperature: 0.1
                    }
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData?.error?.message || `HTTP ${response.status}`;
                return {
                    desc: '', amount: null, currency: 'HKD',
                    date: today, payment: '其他', suggestions: [],
                    error: `Gemini API 錯誤：${errMsg}`
                };
            }

            const data = await response.json();
            const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!rawText) {
                return {
                    desc: '', amount: null, currency: 'HKD',
                    date: today, payment: '其他', suggestions: [],
                    error: 'AI 冇返回結果，請再試一次'
                };
            }

            let parsed;
            try {
                parsed = JSON.parse(rawText);
            } catch (e) {
                // Try to extract JSON from text if wrapped in markdown
                const match = rawText.match(/\{[\s\S]*\}/);
                if (match) {
                    try { parsed = JSON.parse(match[0]); }
                    catch (e2) {
                        return {
                            desc: '', amount: null, currency: 'HKD',
                            date: today, payment: '其他', suggestions: [],
                            error: 'AI 返回格式有問題，請再試一次'
                        };
                    }
                } else {
                    return {
                        desc: '', amount: null, currency: 'HKD',
                        date: today, payment: '其他', suggestions: [],
                        error: 'AI 返回格式有問題，請再試一次'
                    };
                }
            }

            // Validate and normalise fields
            const validPayments = ['現金', '信用卡', '淘寶', '拼多多', '轉數快', '支付寶', '其他'];
            const validCurrencies = ['HKD', 'RMB'];

            return {
                desc: parsed.desc || '',
                amount: typeof parsed.amount === 'number' ? parsed.amount : null,
                currency: validCurrencies.includes(parsed.currency) ? parsed.currency : 'HKD',
                date: parsed.date || '',
                payment: validPayments.includes(parsed.payment) ? parsed.payment : '其他',
                suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
                error: parsed.error || null,
                message: parsed.message || null
            };

        } catch (err) {
            return {
                desc: '', amount: null, currency: 'HKD',
                date: today, payment: '其他', suggestions: [],
                error: `網絡錯誤：${err.message}`
            };
        }
    }
};
