const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

// ID 생성 함수
function generateId(length = 8) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

// In-memory store
const pageStore = new Map();

// 사이트 감지
function detectSite(url) {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('naver.com') || lower.includes('smartstore.naver')) return 'naver';
  if (lower.includes('danawa.com') || lower.includes('shop.danawa')) return 'danawa';
  return 'danawa';
}

// 다나와 파서 (로컬 서버와 동일)
function parseDanawa(html, productUrl) {
  const $ = cheerio.load(html);
  
  // 제목 추출
  const titleOg = $("meta[property='og:title']").attr('content') || '';
  const titleH1 = $('h1, h2, .prod_tit, .product_title').first().text().trim();
  const prodViewHead = $('.prod_view_head').text().trim();
  
  const titleCandidates = [titleOg, titleH1, prodViewHead].filter(Boolean);
  const fullTitle = titleCandidates.length > 0 
    ? titleCandidates.reduce((longest, current) => current.length > longest.length ? current : longest)
    : '상품명 추출 실패';
  
  let title = '', description = '';
  
  if (fullTitle.includes('(') && fullTitle.includes(')')) {
    const parts = fullTitle.split('(');
    title = parts[0].trim();
    description = '(' + parts.slice(1).join('(').trim();
  } else if (fullTitle.includes('/')) {
    const parts = fullTitle.split('/');
    title = parts[0].trim();
    description = parts.slice(1).join(' / ').trim();
  } else {
    title = fullTitle;
    const specText = $('.prod_spec, .spec_list, .product_spec').first().text().trim();
    if (specText) {
      description = specText.substring(0, 200) + (specText.length > 200 ? '...' : '');
    }
  }
  
  const priceText = $('.price, .prod_price, [class*="price"]').first().text().replace(/[^0-9]/g, '');
  
  // 이미지 수집
  const imageCandidates = [];
  
  $("meta[property='og:image']").each((_, el) => {
    const u = $(el).attr('content');
    if (u) imageCandidates.push(u);
  });
  
  $('.prod_view_thumb img, .prod_con_img img').each((_, el) => {
    const img = $(el);
    const candidates = [
      img.attr('src'), img.attr('data-src'), img.attr('data-original'),
      img.attr('data-lazy'), img.attr('data-lazy-src')
    ].filter(Boolean);
    
    candidates.forEach(src => {
      try {
        const absolute = src.startsWith('http') ? src : new URL(src, productUrl).toString();
        if (/\.(jpg|jpeg|png|webp|gif)/i.test(absolute)) {
          imageCandidates.push(absolute);
        }
      } catch (e) {}
    });
  });
  
  const uniqueImages = Array.from(new Set(imageCandidates)).slice(0, 10);
  const descHtml = $('.prod_con_img, .product_detail, .detail_content').first().html() || '';

  return {
    title: title || '상품명 추출 실패',
    description: description || '',
    listPrice: priceText || '',
    salePrice: '',
    images: uniqueImages,
    descriptionHtml: descHtml
  };
}

// 다나와 스크래핑
async function scrapeDanawa(productUrl) {
  try {
    const { data: html } = await axios.get(productUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'referer': 'https://www.google.com/'
      },
      timeout: 15000,
      validateStatus: () => true
    });
    return parseDanawa(html, productUrl);
  } catch (error) {
    console.error('Scraping error:', error.message);
    return { title: '', listPrice: '', salePrice: '', images: [], descriptionHtml: '', description: '' };
  }
}

// 메인 페이지 HTML 생성
function generateMainPageHTML() {
  return `
<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>허락보다 용서가 쉽다! 유부남용 특가 상품 메이커</title>
    <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
    <link rel="alternate icon" href="/assets/favicon.ico">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; min-height: 100vh; }
        .header-section { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 20px; text-align: center; }
        .logo-section { display: flex; align-items: center; justify-content: center; gap: 20px; }
        .logo-icon { font-size: 3rem; }
        .title-section h1 { margin: 0; font-size: 1.8rem; font-weight: bold; line-height: 1.3; }
        .subtitle { font-size: 1rem; opacity: 0.9; margin-top: 8px; }
        .hint { margin-top: 20px; font-size: 0.9rem; opacity: 0.8; }
        
        form { padding: 40px 20px; }
        label { display: block; margin: 20px 0 8px 0; font-weight: 600; color: #333; }
        input, select { width: 100%; padding: 12px 16px; border: 2px solid #e1e5e9; border-radius: 8px; font-size: 16px; box-sizing: border-box; }
        input:focus, select:focus { outline: none; border-color: #667eea; }
        
        button { width: 100%; padding: 16px; background: #667eea; color: white; border: none; border-radius: 8px; font-size: 18px; font-weight: 600; cursor: pointer; margin-top: 30px; }
        button:hover { background: #5a67d8; }
        button:disabled { background: #cbd5e0; cursor: not-allowed; }
        
        .loading { display: none; text-align: center; margin-top: 20px; }
        .spinner { display: inline-block; width: 20px; height: 20px; border: 3px solid #f3f3f3; border-top: 3px solid #667eea; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        
        .result { display: none; margin-top: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px; }
        .result.success { background: #d4edda; border: 1px solid #c3e6cb; }
        .result.error { background: #f8d7da; border: 1px solid #f5c6cb; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header-section">
            <div class="logo-section">
                <div class="logo-icon">💰</div>
                <div class="title-section">
                    <h1>허락보다 용서가 쉽다!<br>유부남용 특가 상품 메이커</h1>
                    <p class="subtitle">쇼핑몰 페이지 빌더</p>
                </div>
            </div>
            <p class="hint">샵다나와 상품 URL을 붙여넣으면 공개 정보 기반으로 요약합니다. 본 페이지는 실제 쇼핑몰이 아닙니다.</p>
        </div>
        
        <form id="gen-form">
            <label>상품 원본 URL</label>
            <input name="productUrl" type="url" placeholder="https://shop.danawa.com/main/?controller=goods&methods=blog&type=blog&productSeq=9589341" required />
            
            <label>상품명(선택)</label>
            <input name="manualTitle" type="text" placeholder="미입력시 상품 원본의 상품명이 표시됩니다." />
            
            <label>정가(선택)</label>
            <input name="listPrice" type="text" placeholder="예: 100000" />
            
            <label>특가(선택)</label>
            <input name="customPrice" type="text" placeholder="예: 80000" />
            
            <input name="template" type="hidden" value="naver" />
            
            <button id="submitBtn" type="submit">페이지 만들기</button>
            
            <div class="loading" id="loading">
                <div class="spinner"></div>
                <span style="margin-left: 10px;">페이지를 생성하고 있습니다...</span>
            </div>
            
            <div class="result" id="result"></div>
        </form>
    </div>
    
    <script>
        document.getElementById('gen-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const submitBtn = document.getElementById('submitBtn');
            const loading = document.getElementById('loading');
            const result = document.getElementById('result');
            
            submitBtn.disabled = true;
            loading.style.display = 'block';
            result.style.display = 'none';
            
            try {
                const response = await fetch('/generate', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    result.className = 'result success';
                    result.innerHTML = \`
                        <h3>✅ 페이지 생성 완료!</h3>
                        <p><strong>생성된 페이지:</strong> <a href="\${data.link}" target="_blank">\${data.link}</a></p>
                        \${data.fallback ? '<p><small>⚠️ 자동 추출에 실패하여 기본 템플릿을 사용했습니다.</small></p>' : ''}
                    \`;
                    result.style.display = 'block';
                } else {
                    throw new Error(data.message || '페이지 생성에 실패했습니다.');
                }
            } catch (error) {
                result.className = 'result error';
                result.innerHTML = \`
                    <h3>❌ 오류 발생</h3>
                    <p>\${error.message}</p>
                \`;
                result.style.display = 'block';
            } finally {
                submitBtn.disabled = false;
                loading.style.display = 'none';
            }
        });
    </script>
</body>
</html>`;
}

// 상품 페이지 HTML 생성
function generateProductPageHTML(data) {
  const images = data.images || ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Product+Image'];
  const thumbnails = images.slice(0, 4); // 최대 4개
  const mainImage = images[0];
  
  const formatPrice = (price) => {
    if (!price) return '';
    return parseInt(price).toLocaleString() + '원';
  };
  
  return `
<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${data.title || '상품페이지'} - 허락보다 용서가 쉽다! 유부남용 특가 상품 메이커</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
        
        .main-header { background: #fff; border-bottom: 1px solid #e9ecef; position: sticky; top: 0; z-index: 100; }
        .main-header__inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; padding: 10px 20px; }
        .naver-logo { font-weight: bold; color: #03c75a; font-size: 24px; margin-right: 30px; }
        .main-nav { display: flex; gap: 20px; }
        .nav-item { color: #333; text-decoration: none; font-weight: 500; cursor: default; }
        
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .product-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 40px; }
        
        .product-images { }
        .main-image { width: 100%; height: 400px; object-fit: cover; border-radius: 8px; margin-bottom: 15px; }
        .thumbnail-gallery { display: flex; gap: 10px; }
        .thumbnail { width: 80px; height: 80px; object-fit: cover; border-radius: 4px; cursor: pointer; border: 2px solid transparent; }
        .thumbnail:hover, .thumbnail.active { border-color: #03c75a; }
        
        .product-info h1 { font-size: 24px; font-weight: 700; margin-bottom: 10px; line-height: 1.3; }
        .product-description { color: #666; font-size: 14px; margin-bottom: 20px; }
        .price-section { margin: 30px 0; }
        .price-row { display: flex; align-items: center; margin-bottom: 10px; }
        .price-label { min-width: 80px; color: #666; font-size: 14px; }
        .list-price { color: #999; text-decoration: line-through; font-size: 16px; }
        .sale-price { color: #e74c3c; font-size: 24px; font-weight: bold; }
        
        .action-buttons { display: flex; gap: 10px; margin-top: 30px; }
        .cart-btn, .buy-btn { flex: 1; height: 52px; border: 2px solid transparent; border-radius: 4px; font-size: 16px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .cart-btn { background: #fff; color: #03c75a; border-color: #03c75a; }
        .buy-btn { background: #03c75a; color: #fff; }
        .cart-btn:hover { background: #f8f9fa; }
        .buy-btn:hover { background: #02b44a; }
        
        .product-detail { margin-top: 40px; }
        .product-detail h2 { font-size: 20px; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #e9ecef; }
        .product-detail img { max-width: 100%; height: auto; }
        
        .naver-footer { background: #f8f9fa; border-top: 1px solid #e9ecef; margin-top: 60px; padding: 40px 0; }
        .footer-content { max-width: 1200px; margin: 0 auto; padding: 0 20px; text-align: center; }
        .footer-actions { margin-bottom: 20px; }
        .top-btn { background: #03c75a; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
        .copyright { color: #666; font-size: 12px; }
        
        @media (max-width: 768px) {
            .product-layout { grid-template-columns: 1fr; gap: 20px; }
            .main-image { height: 300px; }
            .thumbnail { width: 60px; height: 60px; }
            .action-buttons { flex-direction: column; }
            .cart-btn, .buy-btn { height: 56px; }
        }
    </style>
</head>
<body>
    <header class="main-header">
        <div class="main-header__inner">
            <div class="naver-logo">NAVER</div>
            <nav class="main-nav">
                <span class="nav-item" onclick="alert('데모 페이지입니다')">쇼핑</span>
                <span class="nav-item" onclick="alert('데모 페이지입니다')">쇼핑라이브</span>
                <span class="nav-item" onclick="alert('데모 페이지입니다')">스마트스토어</span>
                <span class="nav-item" onclick="alert('데모 페이지입니다')">브랜드스토어</span>
            </nav>
        </div>
    </header>

    <div class="container">
        <div class="product-layout">
            <div class="product-images">
                <img id="mainImage" class="main-image" src="${mainImage}" alt="상품 이미지" />
                ${thumbnails.length > 1 ? `
                <div class="thumbnail-gallery">
                    ${thumbnails.map((img, idx) => `
                        <img class="thumbnail ${idx === 0 ? 'active' : ''}" 
                             src="${img}" 
                             alt="썸네일 ${idx + 1}"
                             onclick="changeMainImage('${img}', this)" />
                    `).join('')}
                </div>
                ` : ''}
            </div>
            
            <div class="product-info">
                <h1>${data.title || '상품명'}</h1>
                ${data.description ? `<p class="product-description">${data.description}</p>` : ''}
                
                <div class="price-section">
                    ${data.listPrice ? `
                    <div class="price-row">
                        <span class="price-label">정가</span>
                        <span class="list-price">${formatPrice(data.listPrice)}</span>
                    </div>
                    ` : ''}
                    ${data.customPrice ? `
                    <div class="price-row">
                        <span class="price-label">특가</span>
                        <span class="sale-price">${formatPrice(data.customPrice)}</span>
                    </div>
                    ` : ''}
                </div>
                
                <div class="action-buttons">
                    <button class="cart-btn" onclick="showLoginPopup()">장바구니</button>
                    <button class="buy-btn" onclick="showLoginPopup()">구매하기</button>
                </div>
            </div>
        </div>
        
        <div class="product-detail">
            <h2>상품 상세정보</h2>
            <div>${data.descriptionHtml || '<p style="text-align:center; padding:40px; color:#666;">상품 상세 정보가 없습니다.</p>'}</div>
        </div>
    </div>

    <footer class="naver-footer">
        <div class="footer-content">
            <div class="footer-actions">
                <button class="top-btn" onclick="window.scrollTo(0,0)">맨위로가기</button>
            </div>
            <p class="copyright">© NAVER Corp. (데모 페이지)</p>
        </div>
    </footer>

    <script>
        function changeMainImage(src, thumbnail) {
            document.getElementById('mainImage').src = src;
            document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
            thumbnail.classList.add('active');
        }
        
        function showLoginPopup() {
            alert('로그인이 필요합니다.\\n\\n실제 서비스에서는 로그인 페이지로 이동됩니다.\\n(현재는 데모 페이지입니다)');
        }
    </script>
</body>
</html>`;
}

// Vercel 서버리스 함수
module.exports = async (req, res) => {
  const { url, method } = req;
  
  try {
    // CORS 헤더 설정
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // OPTIONS 요청 처리
    if (method === 'OPTIONS') {
      return res.status(200).end();
    }

    // 메인 페이지
    if (url === '/' && method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(generateMainPageHTML());
    }
    
    // 페이지 생성
    if (url === '/generate' && method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      
      return new Promise((resolve) => {
        req.on('end', async () => {
          try {
            // Form data 파싱
            const formData = new URLSearchParams(body);
            const productUrl = formData.get('productUrl');
            const manualTitle = formData.get('manualTitle') || '';
            const listPrice = formData.get('listPrice') || '';
            const customPrice = formData.get('customPrice') || '';
            
            let scraped = { title: '', listPrice: '', salePrice: '', images: [], descriptionHtml: '', description: '' };
            
            // 스크래핑 시도
            if (productUrl) {
              const site = detectSite(productUrl);
              if (site === 'danawa') {
                scraped = await scrapeDanawa(productUrl);
              }
            }
            
            const id = generateId(8);
            
            // 이미지 처리
            let finalImages = [];
            if (scraped.images && scraped.images.length > 0) {
              finalImages = scraped.images;
            } else {
              finalImages = ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Product+Image'];
            }
            
            // 상세 콘텐츠 처리
            let finalDescriptionHtml = '';
            if (scraped.descriptionHtml && scraped.descriptionHtml.trim()) {
              finalDescriptionHtml = scraped.descriptionHtml;
            } else if (finalImages[0] !== 'https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Product+Image') {
              finalDescriptionHtml = \`<div style="text-align:center; padding:40px;">
                   <img src="\${finalImages[0]}" style="max-width:100%; height:auto; border-radius:8px;" alt="상품 상세 이미지" />
                   <p style="margin-top:20px; color:#666; font-size:14px;">상품 이미지 (자동 추출)</p>
                 </div>\`;
            } else {
              finalDescriptionHtml = '<div style="text-align:center; padding:40px; color:#666;">상품 상세 정보를 불러올 수 없습니다.</div>';
            }
            
            const pageData = {
              id,
              template: 'naver',
              productUrl,
              title: manualTitle || scraped.title || '상품명(미확인)',
              description: scraped.description || '',
              listPrice: (listPrice || scraped.listPrice || '').toString().replace(/[^0-9]/g, ''),
              customPrice: customPrice.toString().replace(/[^0-9]/g, ''),
              images: finalImages,
              descriptionHtml: finalDescriptionHtml
            };
            
            pageStore.set(id, pageData);
            
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json({ 
              id, 
              link: \`\${req.headers.origin || 'https://' + req.headers.host}/p/\${id}\`,
              success: true 
            });
            resolve();
          } catch (error) {
            console.error('Generate error:', error);
            res.setHeader('Content-Type', 'application/json');
            res.status(500).json({ error: 'Generation failed', message: error.message });
            resolve();
          }
        });
      });
    }
    
    // 상품 페이지
    const productPageMatch = url.match(/^\/p\/([a-zA-Z0-9]+)$/);
    if (productPageMatch && method === 'GET') {
      const id = productPageMatch[1];
      const data = pageStore.get(id);
      
      if (!data) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(404).send('<h1>404 - 페이지가 존재하지 않습니다.</h1>');
      }
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(generateProductPageHTML(data));
    }
    
    // 404
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(404).send('<h1>404 - 페이지를 찾을 수 없습니다.</h1>');
    
  } catch (error) {
    console.error('Function error:', error);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message 
    });
  }
};
