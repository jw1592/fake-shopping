// 가장 기본적인 Vercel 서버리스 함수
module.exports = (req, res) => {
  console.log('Minimal function called:', req.method, req.url);
  
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <title>테스트 성공! - 허락보다 용서가 쉽다!</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            max-width: 600px; 
            margin: 50px auto; 
            padding: 20px; 
            text-align: center; 
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
        }
        .success { font-size: 3rem; margin-bottom: 2rem; }
        h1 { font-size: 2rem; margin-bottom: 1rem; }
        p { font-size: 1.2rem; opacity: 0.9; }
        .time { font-size: 1rem; margin-top: 2rem; opacity: 0.7; }
    </style>
</head>
<body>
    <div class="success">🎉</div>
    <h1>허락보다 용서가 쉽다!<br>유부남용 특가 상품 메이커</h1>
    <p>✅ Vercel 서버리스 함수가 성공적으로 작동하고 있습니다!</p>
    <p>🚀 이제 전체 기능을 추가할 준비가 되었습니다.</p>
    <div class="time">테스트 시간: ${new Date().toISOString()}</div>
</body>
</html>
      `);
    }
    
    // 404
    res.setHeader('Content-Type', 'application/json');
    res.status(404).json({ 
      error: 'Not Found', 
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Minimal function error:', error);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ 
      error: 'Function Error',
      message: error.message,
      stack: error.stack
    });
  }
};
