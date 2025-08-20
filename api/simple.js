// Express 없이 간단한 HTML 응답
module.exports = (req, res) => {
  try {
    const html = `
<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>허락보다 용서가 쉽다! 유부남용 특가 상품 메이커</title>
    <style>
      body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        max-width: 600px; 
        margin: 50px auto; 
        padding: 20px; 
        text-align: center;
      }
      .logo { font-size: 2rem; margin-bottom: 1rem; }
      .title { color: #333; margin-bottom: 2rem; }
      .form { max-width: 400px; margin: 0 auto; }
      input, button { 
        width: 100%; 
        padding: 12px; 
        margin: 8px 0; 
        border: 1px solid #ddd; 
        border-radius: 4px;
        font-size: 16px;
      }
      button { 
        background: #007bff; 
        color: white; 
        border: none; 
        cursor: pointer; 
      }
      button:hover { background: #0056b3; }
    </style>
</head>
<body>
    <div class="logo">💰</div>
    <h1 class="title">허락보다 용서가 쉽다!<br>유부남용 특가 상품 메이커</h1>
    <div class="form">
        <input type="url" placeholder="https://shop.danawa.com/main/?controller=goods..." required />
        <input type="text" placeholder="상품명(선택)" />
        <input type="text" placeholder="정가(선택)" />
        <input type="text" placeholder="특가(선택)" />
        <button onclick="alert('서버 연결 테스트 성공!')">페이지 만들기</button>
    </div>
    <p style="margin-top: 2rem; color: #666; font-size: 14px;">
        샵다나와 상품 URL을 붙여넣으면 공개 정보 기반으로 요약합니다.<br>
        본 페이지는 실제 쇼핑몰이 아닙니다.
    </p>
    <p style="color: green; font-weight: bold;">✅ Vercel 서버리스 함수 작동 중!</p>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
    
  } catch (error) {
    console.error('Simple function error:', error);
    res.status(500).json({ error: 'Simple function failed', message: error.message });
  }
};
