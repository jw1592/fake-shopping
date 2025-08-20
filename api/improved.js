const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

// URL 안전한 Base64 인코딩/디코딩
function urlSafeBase64Encode(data) {
  return Buffer.from(JSON.stringify(data))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function urlSafeBase64Decode(encoded) {
  try {
    // padding 추가
    while (encoded.length % 4) {
      encoded += '=';
    }
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(base64, 'base64').toString());
  } catch (error) {
    console.error('Decode error:', error);
    return null;
  }
}

// ID 생성 함수
function generateId(length = 8) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

// 사이트 감지
function detectSite(url) {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('naver.com') || lower.includes('smartstore.naver')) return 'naver';
  if (lower.includes('danawa.com') || lower.includes('shop.danawa')) return 'danawa';
  return 'danawa';
}

// 개선된 다나와 파서
function parseDanawa(html, productUrl) {
  try {
    console.log('HTML length:', html.length);
    
    const $ = cheerio.load(html);
    console.log('Cheerio loaded successfully');
    
    // 여러 방법으로 제목 추출 시도
    const titleSelectors = [
      "meta[property='og:title']",
      '.prod_view_head',
      '.prod_tit',
      '.product_title',
      'h1',
      'h2'
    ];
    
    let title = '';
    for (const selector of titleSelectors) {
      if (selector.startsWith('meta')) {
        title = $(selector).attr('content') || '';
      } else {
        title = $(selector).first().text().trim();
      }
      if (title && title.length > 3) {
        console.log(`Title found with selector '${selector}':`, title.substring(0, 50));
        break;
      }
    }
    
    if (!title) {
      title = $('title').text().trim();
      console.log('Using page title:', title.substring(0, 50));
    }
    
    // 설명 추출
    let description = '';
    if (title.includes('(') && title.includes(')')) {
      const parts = title.split('(');
      title = parts[0].trim();
      description = '(' + parts.slice(1).join('(').trim();
    } else if (title.includes('/')) {
      const parts = title.split('/');
      title = parts[0].trim();
      description = parts.slice(1).join(' / ').trim();
    }
    
    // 가격 추출
    const priceSelectors = ['.price', '.prod_price', '[class*="price"]'];
    let priceText = '';
    for (const selector of priceSelectors) {
      priceText = $(selector).first().text().replace(/[^0-9]/g, '');
      if (priceText) {
        console.log(`Price found with selector '${selector}':`, priceText);
        break;
      }
    }
    
    // 이미지 수집
    const imageCandidates = [];
    
    // 1) og:image 메타태그
    const ogImage = $("meta[property='og:image']").attr('content');
    if (ogImage) {
      imageCandidates.push(ogImage);
      console.log('OG image found:', ogImage);
    }
    
    // 2) 다양한 이미지 선택자로 수집
    const imageSelectors = [
      '.prod_view_thumb img',
      '.prod_con_img img', 
      '.product_img img',
      '.thumb_img img',
      'img[src*="danawa"]',
      'img[data-src*="danawa"]'
    ];
    
    for (const selector of imageSelectors) {
      $(selector).each((_, el) => {
        const img = $(el);
        const candidates = [
          img.attr('src'),
          img.attr('data-src'),
          img.attr('data-original'),
          img.attr('data-lazy'),
          img.attr('data-lazy-src')
        ].filter(Boolean);
        
        candidates.forEach(src => {
          try {
            let absolute = src;
            if (!src.startsWith('http')) {
              if (src.startsWith('//')) {
                absolute = 'https:' + src;
              } else {
                absolute = new URL(src, productUrl).toString();
              }
            }
            
            if (/\.(jpg|jpeg|png|webp|gif)/i.test(absolute) && 
                (absolute.includes('danawa') || absolute.includes('pstatic'))) {
              imageCandidates.push(absolute);
            }
          } catch (e) {
            console.log('Invalid image URL:', src);
          }
        });
      });
    }
    
    const uniqueImages = Array.from(new Set(imageCandidates)).slice(0, 10);
    console.log('Images found:', uniqueImages.length);
    
    // 상세 이미지 추출
    const detailImages = [];
    $('.prod_con_img img').each((_, el) => {
      const img = $(el);
      const src = img.attr('src') || img.attr('data-src') || img.attr('data-original');
      if (src) {
        try {
          let absolute = src;
          if (!src.startsWith('http')) {
            if (src.startsWith('//')) {
              absolute = 'https:' + src;
            } else {
              absolute = new URL(src, productUrl).toString();
            }
          }
          if (/\.(jpg|jpeg|png|webp|gif)/i.test(absolute)) {
            detailImages.push(absolute);
          }
        } catch (e) {}
      }
    });
    
    console.log('Detail images found:', detailImages.length);
    
    const result = {
      title: title || '상품명 추출 실패',
      description: description || '',
      listPrice: priceText || '',
      salePrice: '',
      images: uniqueImages.length > 0 ? uniqueImages : ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=No+Image'],
      detailImages: detailImages.slice(0, 5)
    };
    
    console.log('Parse result:', {
      title: result.title.substring(0, 50),
      images: result.images.length,
      detailImages: result.detailImages.length
    });
    
    return result;
    
  } catch (error) {
    console.error('Parse error:', error);
    return { 
      title: '파싱 오류', 
      listPrice: '', 
      salePrice: '', 
      images: ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Parse+Error'], 
      detailImages: [], 
      description: '' 
    };
  }
}

// 개선된 다나와 스크래핑
async function scrapeDanawa(productUrl) {
  console.log('=== Danawa Scraping Start ===');
  console.log('URL:', productUrl);
  
  try {
    // 여러 헤더 설정 시도
    const headers = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'accept-encoding': 'gzip, deflate, br',
      'referer': 'https://www.google.com/',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'cross-site',
      'upgrade-insecure-requests': '1'
    };
    
    console.log('Making HTTP request...');
    const response = await axios.get(productUrl, {
      headers,
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.keys(response.headers));
    console.log('HTML length:', response.data.length);
    
    if (response.status !== 200) {
      console.log('Non-200 status code:', response.status);
      return { 
        title: \`HTTP \${response.status} 오류\`, 
        listPrice: '', 
        salePrice: '', 
        images: ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=HTTP+Error'], 
        detailImages: [], 
        description: '' 
      };
    }
    
    // HTML 내용 확인
    const html = response.data;
    if (html.length < 1000) {
      console.log('HTML too short, might be blocked');
      console.log('HTML preview:', html.substring(0, 500));
    }
    
    // 차단 페이지 감지
    if (html.includes('차단') || html.includes('접근이 제한') || html.includes('bot') || html.includes('robot')) {
      console.log('Detected blocking page');
      return { 
        title: '접근 차단됨', 
        listPrice: '', 
        salePrice: '', 
        images: ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Access+Blocked'], 
        detailImages: [], 
        description: '' 
      };
    }
    
    const result = parseDanawa(html, productUrl);
    console.log('=== Danawa Scraping End ===');
    return result;
    
  } catch (error) {
    console.error('Scraping error:', error.message);
    console.error('Error details:', error);
    
    return { 
      title: '스크래핑 오류: ' + error.message, 
      listPrice: '', 
      salePrice: '', 
      images: ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Scraping+Error'], 
      detailImages: [], 
      description: '' 
    };
  }
}

// 메인 페이지 HTML 생성
function generateMainPageHTML() {
  return \`<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>허락보다 용서가 쉽다! 유부남용 특가 상품 메이커</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='20' font-size='20'%3E💰%3C/text%3E%3C/svg%3E">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; min-height: 100vh; }
        .header-section { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 20px; text-align: center; }
        .logo-section { display: flex; align-items: center; justify-content: center; gap: 20px; flex-wrap: wrap; }
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
        
        .result { display: none; margin-top: 30px; padding: 20px; border-radius: 8px; }
        .result.success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
        .result.error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
        .result h3 { margin: 0 0 10px 0; }
        .result a { color: #007bff; text-decoration: none; }
        .result a:hover { text-decoration: underline; }
        .share-info { margin-top: 15px; padding: 15px; background: #e7f3ff; border: 1px solid #b3d9ff; border-radius: 4px; font-size: 14px; }
        .share-info strong { color: #0066cc; }
        .debug-info { margin-top: 10px; padding: 10px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; font-size: 12px; font-family: monospace; }
        
        @media (max-width: 768px) {
            .logo-section { flex-direction: column; gap: 10px; }
            .title-section h1 { font-size: 1.5rem; }
            form { padding: 20px 15px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header-section">
            <div class="logo-section">
                <div class="logo-icon">💰</div>
                <div class="title-section">
                    <h1>허락보다 용서가 쉽다!<br>유부남용 특가 상품 메이커</h1>
                    <p class="subtitle">쇼핑몰 페이지 빌더 (개선된 스크래핑)</p>
                </div>
            </div>
            <p class="hint">샵다나와 상품 URL을 붙여넣으면 공개 정보 기반으로 요약합니다. 스크래핑 오류 시 자세한 정보를 제공합니다.</p>
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
            
            <button id="submitBtn" type="submit">페이지 만들기 (개선된 스크래핑)</button>
            
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
                    result.innerHTML = \\\`
                        <h3>✅ 페이지 생성 완료!</h3>
                        <p><strong>생성된 페이지:</strong> <a href="\\\${data.link}" target="_blank">\\\${data.link}</a></p>
                        <div class="share-info">
                            <strong>🔗 공유 안내:</strong> 위 링크는 다른 사람과 공유할 수 있습니다! 
                            상품 정보가 URL에 안전하게 저장되어 있어 언제든지 동일한 페이지를 볼 수 있습니다.
                        </div>
                        \\\${data.debugInfo ? '<div class="debug-info"><strong>디버그 정보:</strong><br>' + data.debugInfo + '</div>' : ''}
                        \\\${data.fallback ? '<p><small>⚠️ 자동 추출에 실패하여 기본 템플릿을 사용했습니다.</small></p>' : ''}
                    \\\`;
                    result.style.display = 'block';
                } else {
                    throw new Error(data.message || '페이지 생성에 실패했습니다.');
                }
            } catch (error) {
                result.className = 'result error';
                result.innerHTML = \\\`
                    <h3>❌ 오류 발생</h3>
                    <p>\\\${error.message}</p>
                \\\`;
                result.style.display = 'block';
            } finally {
                submitBtn.disabled = false;
                loading.style.display = 'none';
            }
        });
    </script>
</body>
</html>\`;
}

// 상품 페이지 HTML 생성
function generateProductPageHTML(data) {
  const images = data.images || ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=No+Image'];
  const thumbnails = images.slice(0, 4); // 최대 4개
  const mainImage = images[0];
  
  const formatPrice = (price) => {
    if (!price) return '';
    return parseInt(price).toLocaleString() + '원';
  };
  
  // 상세 이미지들로 HTML 생성
  let detailHtml = '';
  if (data.detailImages && data.detailImages.length > 0) {
    detailHtml = data.detailImages.map(img => 
      \`<div style="text-align:center; margin-bottom:20px;">
        <img src="\${img}" style="max-width:100%; height:auto;" alt="상품 상세 이미지" onerror="this.style.display='none'" />
       </div>\`
    ).join('');
  } else if (mainImage && !mainImage.includes('placeholder')) {
    detailHtml = \`<div style="text-align:center; padding:40px;">
         <img src="\${mainImage}" style="max-width:100%; height:auto; border-radius:8px;" alt="상품 상세 이미지" />
         <p style="margin-top:20px; color:#666; font-size:14px;">상품 이미지 (자동 추출)</p>
       </div>\`;
  } else {
    detailHtml = '<div style="text-align:center; padding:40px; color:#666;">상품 상세 정보가 없습니다.</div>';
  }
  
  return \`<!doctype html>
<html lang="ko">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>\${data.title || '상품페이지'} - 허락보다 용서가 쉽다! 유부남용 특가 상품 메이커</title>
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ctext y='20' font-size='20'%3E💰%3C/text%3E%3C/svg%3E">
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
        .thumbnail-gallery { display: flex; gap: 10px; flex-wrap: wrap; }
        .thumbnail { width: 80px; height: 80px; object-fit: cover; border-radius: 4px; cursor: pointer; border: 2px solid transparent; }
        .thumbnail:hover, .thumbnail.active { border-color: #03c75a; }
        
        .product-info h1 { font-size: 24px; font-weight: 700; margin-bottom: 10px; line-height: 1.3; }
        .product-description { color: #666; font-size: 14px; margin-bottom: 20px; line-height: 1.4; }
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
            .container { padding: 10px; }
            .main-header__inner { padding: 10px 15px; }
            .naver-logo { font-size: 20px; margin-right: 15px; }
            .main-nav { gap: 15px; }
            .nav-item { font-size: 14px; }
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
                <img id="mainImage" class="main-image" src="\${mainImage}" alt="상품 이미지" onerror="this.src='https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Image+Error'" />
                \${thumbnails.length > 1 ? \`
                <div class="thumbnail-gallery">
                    \${thumbnails.map((img, idx) => \`
                        <img class="thumbnail \${idx === 0 ? 'active' : ''}" 
                             src="\${img}" 
                             alt="썸네일 \${idx + 1}"
                             onclick="changeMainImage('\${img}', this)"
                             onerror="this.style.display='none'" />
                    \`).join('')}
                </div>
                \` : ''}
            </div>
            
            <div class="product-info">
                <h1>\${data.title || '상품명'}</h1>
                \${data.description ? \`<p class="product-description">\${data.description}</p>\` : ''}
                
                <div class="price-section">
                    \${data.listPrice ? \`
                    <div class="price-row">
                        <span class="price-label">정가</span>
                        <span class="list-price">\${formatPrice(data.listPrice)}</span>
                    </div>
                    \` : ''}
                    \${data.customPrice ? \`
                    <div class="price-row">
                        <span class="price-label">특가</span>
                        <span class="sale-price">\${formatPrice(data.customPrice)}</span>
                    </div>
                    \` : ''}
                </div>
                
                <div class="action-buttons">
                    <button class="cart-btn" onclick="showLoginPopup()">장바구니</button>
                    <button class="buy-btn" onclick="showLoginPopup()">구매하기</button>
                </div>
            </div>
        </div>
        
        <div class="product-detail">
            <h2>상품 상세정보</h2>
            <div>\${detailHtml}</div>
        </div>
    </div>

    <footer class="naver-footer">
        <div class="footer-content">
            <div class="footer-actions">
                <button class="top-btn" onclick="window.scrollTo({top:0,behavior:'smooth'})">맨위로가기</button>
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
            alert('로그인이 필요합니다.\\\\n\\\\n실제 서비스에서는 로그인 페이지로 이동됩니다.\\\\n(현재는 데모 페이지입니다)');
        }
    </script>
</body>
</html>\`;
}

// Vercel 서버리스 함수
module.exports = async (req, res) => {
  const { url, method } = req;
  
  try {
    console.log(\`\${method} \${url}\`);
    
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
            
            console.log('=== Generate Request Start ===');
            console.log('Product URL:', productUrl);
            console.log('Manual title:', manualTitle);
            console.log('Prices:', listPrice, customPrice);
            
            let scraped = { title: '', listPrice: '', salePrice: '', images: [], detailImages: [], description: '' };
            let debugInfo = '';
            
            // 스크래핑 시도
            if (productUrl) {
              const site = detectSite(productUrl);
              console.log('Detected site:', site);
              debugInfo += \`감지된 사이트: \${site}. \`;
              
              if (site === 'danawa') {
                scraped = await scrapeDanawa(productUrl);
                debugInfo += \`스크래핑 결과: 제목=\${scraped.title.substring(0, 30)}, 이미지=\${scraped.images.length}개, 상세이미지=\${scraped.detailImages.length}개\`;
                
                console.log('Final scraping result:', { 
                  title: scraped.title, 
                  images: scraped.images.length,
                  detailImages: scraped.detailImages.length,
                  description: scraped.description ? scraped.description.substring(0, 50) + '...' : 'None'
                });
              }
            }
            
            // 이미지 처리
            let finalImages = [];
            if (scraped.images && scraped.images.length > 0 && !scraped.images[0].includes('placeholder') && !scraped.images[0].includes('Error')) {
              finalImages = scraped.images;
              debugInfo += \`. 실제 이미지 \${finalImages.length}개 사용\`;
            } else {
              finalImages = ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=No+Images+Found'];
              debugInfo += \`. 플레이스홀더 이미지 사용 (스크래핑 실패)\`;
            }
            
            const pageData = {
              productUrl,
              title: manualTitle || scraped.title || '상품명(미확인)',
              description: scraped.description || '',
              listPrice: (listPrice || scraped.listPrice || '').toString().replace(/[^0-9]/g, ''),
              customPrice: customPrice.toString().replace(/[^0-9]/g, ''),
              images: finalImages,
              detailImages: scraped.detailImages || []
            };
            
            // URL에 데이터 인코딩
            const encodedData = urlSafeBase64Encode(pageData);
            const productLink = \`\${req.headers.origin || 'https://' + req.headers.host}/p/\${encodedData}\`;
            
            console.log('Encoded data length:', encodedData.length);
            console.log('=== Generate Request End ===');
            
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json({ 
              link: productLink,
              success: true,
              debugInfo: debugInfo
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
    const productPageMatch = url.match(/^\/p\/([A-Za-z0-9\-_]+)$/);
    if (productPageMatch && method === 'GET') {
      const encodedData = productPageMatch[1];
      const data = urlSafeBase64Decode(encodedData);
      
      console.log('Product page request with encoded data length:', encodedData.length, 'Decoded:', !!data);
      if (data) {
        console.log('Decoded data preview:', {
          title: data.title,
          images: data.images ? data.images.length : 0,
          detailImages: data.detailImages ? data.detailImages.length : 0
        });
      }
      
      if (!data) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(404).send(\`
          <h1>404 - 잘못된 페이지 링크입니다</h1>
          <p>링크가 손상되었거나 유효하지 않습니다.</p>
          <p>인코딩된 데이터 길이: \${encodedData.length}</p>
          <p><a href="/">← 새로운 페이지 만들기</a></p>
        \`);
      }
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(generateProductPageHTML(data));
    }
    
    // 404
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(404).send('<h1>404 - 페이지를 찾을 수 없습니다.</h1><p><a href="/">← 메인 페이지로 돌아가기</a></p>');
    
  } catch (error) {
    console.error('Function error:', error);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
};
