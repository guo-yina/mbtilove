// Vercel Serverless Function — 通义千问 qwen-plus 代理
// 前端 POST /api/guess { name, text, tags } → 服务端持密钥调用百炼 → 返回结构化 JSON
// 密钥来自环境变量 DASHSCOPE_API_KEY，绝不出现在前端。

const SYS =
  '你是资深 MBTI / 荣格八维分析师。根据用户对某人的行为描述与补充标签，推断最可能的 MBTI 类型。' +
  '只输出一个 JSON 对象，不要 Markdown、不要多余文字。结构：' +
  '{"type":"四字大写如ENFP","nickname":"中文昵称如竞选者","tagline":"一句中文副标题","group":"如 外交家 · NF",' +
  '"confidence":0到100整数,"summary":"一句话中文总结",' +
  '"dims":[四项，依次对应 E/I、N/S、F/T、P/J，每项 {"left":"如 E 外向","right":"如 I 内向","leftPct":0到100整数，表示更偏向 left 一侧的百分比}],' +
  '"evidence":[三到四条中文，每条引用描述中的具体行为并对应到某个维度],' +
  '"second":{"type":"四字","nickname":"中文昵称","reason":"一句中文","confidence":0到100整数},' +
  '"secondHint":"一句中文，说明在什么情况下更可能是第二候选"}';

async function readBody(req) {
  if (req.body) {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: '仅支持 POST' });
    return;
  }

  const key = process.env.DASHSCOPE_API_KEY;
  if (!key) {
    res.status(500).json({ error: '服务端未配置 DASHSCOPE_API_KEY 环境变量' });
    return;
  }

  let inp;
  try {
    inp = await readBody(req);
  } catch (e) {
    res.status(400).json({ error: '请求体解析失败' });
    return;
  }

  const name = (inp.name || 'TA').toString().trim();
  const text = (inp.text || '').toString().trim();
  const tags = Array.isArray(inp.tags) ? inp.tags : [];
  if (!text) {
    res.status(400).json({ error: '缺少行为描述内容' });
    return;
  }

  const user =
    '【TA 是谁】' + name +
    '\n【行为描述】' + text +
    '\n【补充标签】' + (tags.join('、') || '（无）');

  try {
    const upstream = await fetch(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + key,
        },
        body: JSON.stringify({
          model: 'qwen-plus',
          temperature: 0.5,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYS },
            { role: 'user', content: user },
          ],
        }),
      }
    );

    if (!upstream.ok) {
      let detail = '';
      try {
        detail = (await upstream.json())?.error?.message || '';
      } catch (e) {}
      res
        .status(502)
        .json({ error: '模型调用失败 HTTP ' + upstream.status + (detail ? '：' + detail : '') });
      return;
    }

    const j = await upstream.json();
    let txt =
      (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const s = txt.indexOf('{');
    const e = txt.lastIndexOf('}');
    if (s >= 0 && e > s) txt = txt.slice(s, e + 1);

    const data = JSON.parse(txt);
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: '解析模型返回失败：' + ((err && err.message) || '未知错误') });
  }
}
