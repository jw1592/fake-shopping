const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

// 구글 시트 설정
const GOOGLE_SHEET_ID = '1oAYTXUow6mQnOh5kfv3xFJQJL02C0Va0EropeM2aSxQ';
const GOOGLE_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=0`;

// ID 생성 함수
function generateId(length = 8) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

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

// 구글 시트에서 상품 데이터 가져오기
async function getProductFromSheet(contentId) {
  try {
    console.log('Fetching product data for:', contentId);
    
    const response = await axios.get(GOOGLE_SHEET_CSV_URL, {
      timeout: 10000
    });
    
    // CSV 파싱 (간단한 방식)
    const lines = response.data.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    console.log('Sheet headers:', headers);
    
    // content_id로 해당 행 찾기
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // CSV 파싱 (따옴표 처리)
      const values = [];
      let current = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim()); // 마지막 값
      
      const rowContentId = values[0]?.replace(/"/g, '');
      
      if (rowContentId === contentId) {
        // 데이터 객체 생성
        const productData = {
          content_id: values[0]?.replace(/"/g, '') || '',
          product_name: values[1]?.replace(/"/g, '') || '',
          product_desc: values[2]?.replace(/"/g, '') || '',
          thumb_img_url: values[3]?.replace(/"/g, '') || '',
          product_img_url: values[4]?.replace(/"/g, '') || ''
        };
        
        // 이미지 URL들을 배열로 변환
        const thumbImages = productData.thumb_img_url 
          ? productData.thumb_img_url.split(',').map(url => url.trim()).filter(url => url)
          : [];
        const detailImages = productData.product_img_url 
          ? productData.product_img_url.split(',').map(url => url.trim()).filter(url => url)
          : [];
        
        const result = {
          title: productData.product_name,
          description: productData.product_desc,
          images: [...thumbImages, ...detailImages], // 썸네일 + 상세 이미지
          thumbnails: thumbImages.slice(0, 4), // 썸네일 최대 4개
          detailImages: detailImages,
          listPrice: '',
          customPrice: '',
          contentId: productData.content_id
        };
        
        console.log('Found product:', result.title);
        return result;
      }
    }
    
    console.log('Product not found:', contentId);
    return null;
    
  } catch (error) {
    console.error('Sheet fetch error:', error.message);
    return null;
  }
}

// 다나와 스크래핑 (개선된 버전)
async function scrapeDanawa(productUrl) {
  try {
    console.log('Scraping Danawa:', productUrl);
    
    const response = await axios.get(productUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3',
        'Accept-Encoding': 'gzip, deflate',
        'Referer': 'https://shop.danawa.com/',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 15000
    });
    
    console.log('Response status:', response.status, 'Length:', response.data.length);
    const $ = cheerio.load(response.data);
    
    // 제목 추출 (여러 방법 시도)
    let title = '';
    const titleSelectors = [
      'meta[property="og:title"]',
      '.prod_view_head',
      '.prod_tit',
      'h1',
      'title',
      '.product_title',
      '.goods_name'
    ];
    
    for (const selector of titleSelectors) {
      if (!title) {
        if (selector.startsWith('meta')) {
          title = $(selector).attr('content');
        } else {
          title = $(selector).first().text().trim();
        }
        if (title) {
          console.log(`Title found with selector "${selector}":`, title.substring(0, 50));
          break;
        }
      }
    }
    
    // 이미지 수집
    const images = [];
    
    // OG 이미지
    $('meta[property="og:image"]').each((_, el) => {
      const img = $(el).attr('content');
      if (img && img.startsWith('http')) {
        images.push(img);
        console.log('OG Image found');
      }
    });
    
    // 썸네일 이미지
    $('.prod_view_thumb img').each((_, el) => {
      const img = $(el);
      let src = img.attr('src') || img.attr('data-src') || img.attr('data-original');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;
        if (src.startsWith('http')) {
          images.push(src);
          console.log('Thumbnail found');
        }
      }
    });
    
    // 상세 이미지
    $('.prod_con_img img').each((_, el) => {
      const img = $(el);
      let src = img.attr('src') || img.attr('data-src') || img.attr('data-original');
      if (src) {
        if (src.startsWith('//')) src = 'https:' + src;
        if (src.startsWith('http')) {
          images.push(src);
          console.log('Detail image found');
        }
      }
    });
    
    // 일반적인 상품 이미지들도 확인
    $('img').each((_, el) => {
      const img = $(el);
      let src = img.attr('src') || img.attr('data-src');
      if (src && src.includes('prod') && src.startsWith('http')) {
        images.push(src);
      }
    });
    
    const uniqueImages = [...new Set(images)].slice(0, 10);
    
    // 상품 설명 추출
    let description = $('.prod_view_head').text().trim();
    if (!description) {
      description = $('.product_desc, .goods_desc').first().text().trim();
    }
    
    const result = {
      title: title || '상품명 추출 실패',
      images: uniqueImages,
      listPrice: '',
      description: description ? description.substring(0, 200) : ''
    };
    
    console.log('Scraping result:', { 
      title: result.title.substring(0, 50), 
      images: result.images.length,
      hasDescription: !!result.description 
    });
    
    return result;
    
  } catch (error) {
    console.error('Scraping error:', error.message);
    console.error('Error status:', error.response?.status, error.response?.statusText);
    return {
      title: '스크래핑 오류: ' + error.message,
      images: [],
      listPrice: '',
      description: ''
    };
  }
}

// 메인 페이지 HTML
function getMainPageHTML() {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <title>허락보다 용서가 쉽다! 유부남용 특가 상품 메이커</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            max-width: 600px; 
            margin: 50px auto; 
            padding: 20px; 
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            min-height: 100vh;
        }
        .container { text-align: center; }
        .logo { font-size: 3rem; margin-bottom: 1rem; }
        h1 { font-size: 1.8rem; margin-bottom: 2rem; }
        form { background: white; color: #333; padding: 30px; border-radius: 8px; margin: 20px 0; }
        input, button { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        button { background: #667eea; color: white; border: none; cursor: pointer; font-size: 16px; }
        button:hover { background: #5a67d8; }
        .result { margin-top: 20px; padding: 15px; border-radius: 4px; }
        .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">💰</div>
        <h1>허락보다 용서가 쉽다!<br>유부남용 특가 상품 메이커</h1>
        <p>다나와 URL을 입력하면 자동으로 스크래핑해서 구글 시트에 저장하고 상품 페이지를 생성합니다.</p>
        
        <form id="productForm">
            <input type="url" name="productUrl" placeholder="다나와 상품 URL" required />
            <input type="text" name="listPrice" placeholder="정가 (선택)" />
            <input type="text" name="customPrice" placeholder="특가 (선택)" />
            <button type="submit">스크래핑 후 페이지 만들기</button>
        </form>
        
        <div style="margin-top: 20px; padding: 15px; background: rgba(255,255,255,0.1); border-radius: 8px; font-size: 14px;">
            <p><strong>💡 새로운 방식:</strong></p>
            <p>1. 다나와 URL 입력 → 자동 스크래핑</p>
            <p>2. 스크래핑 성공 → 구글 시트에 자동 저장</p>
            <p>3. content_id 생성 → 상품 페이지 생성</p>
            <p>4. 다음번부터는 빠른 조회 가능!</p>
        </div>
        
        <div id="result"></div>
    </div>
    
    <script>
        document.getElementById('productForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const urlParams = new URLSearchParams();
            
            // FormData를 URLSearchParams로 변환
            for (const [key, value] of formData.entries()) {
                urlParams.append(key, value);
            }
            
            const result = document.getElementById('result');
            
            try {
                result.innerHTML = '<div>페이지를 생성하고 있습니다...</div>';
                
                const response = await fetch('/generate', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: urlParams.toString()
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    let html = '<div class="success">';
                    html += '<h3>✅ ' + data.message + '</h3>';
                    html += '<p><a href="' + data.link + '" target="_blank">생성된 페이지 보기</a></p>';
                    
                    if (data.sheetData) {
                        html += '<div style="margin-top: 15px; padding: 10px; background: #f8f9fa; border-radius: 4px; font-size: 12px;">';
                        html += '<strong>📝 구글 시트에 추가할 데이터:</strong><br>';
                        html += 'A: ' + data.sheetData.content_id + '<br>';
                        html += 'B: ' + data.sheetData.product_name + '<br>';
                        html += 'C: ' + data.sheetData.product_desc + '<br>';
                        html += 'D: ' + data.sheetData.thumb_img_url + '<br>';
                        html += 'E: ' + data.sheetData.product_img_url;
                        html += '</div>';
                    }
                    
                    html += '</div>';
                    result.innerHTML = html;
                } else {
                    result.innerHTML = '<div class="error"><h3>❌ 오류</h3><p>' + data.message + '</p></div>';
                }
            } catch (error) {
                result.innerHTML = '<div class="error"><h3>❌ 오류</h3><p>' + error.message + '</p></div>';
            }
        });
    </script>
</body>
</html>`;
}

// 상품 페이지 HTML
function getProductPageHTML(data) {
  console.log('Generating page with data:', JSON.stringify(data, null, 2));
  const images = data.images || ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=No+Image'];
  const mainImage = images[0];
  const thumbnails = images.slice(0, 4); // 썸네일 최대 4개
  const detailImages = images.slice(4); // 나머지는 상세 이미지
  
  return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <title>${data.title} - 상품 페이지</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; color: #333; }
        
        /* 헤더 스타일 */
        .main-header__inner { 
            background: #fff; 
            border-bottom: 1px solid #e5e5e5; 
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .header-content { 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 0 20px; 
            display: flex; 
            align-items: center; 
            justify-content: space-between; 
            height: 60px; 
        }
        .header-logo { 
            font-size: 28px; 
            font-weight: bold; 
            color: #1e88e5; 
            text-decoration: none; 
        }
        .header-nav { 
            display: flex; 
            gap: 30px; 
        }
        .header-nav a { 
            text-decoration: none; 
            color: #666; 
            font-weight: 500; 
            cursor: pointer; 
        }
        .header-nav a:hover { 
            color: #1e88e5; 
        }
        .header-utils { 
            display: flex; 
            gap: 15px; 
            align-items: center; 
        }
        .header-utils span { 
            color: #666; 
            cursor: pointer; 
        }
        
        /* 메인 컨테이너 */
        .container { max-width: 1200px; margin: 0 auto; padding: 30px 20px; }
        .product-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 50px; align-items: start; }
        
        /* 이미지 영역 */
        .product-images { position: sticky; top: 20px; }
        .main-image { width: 100%; height: 450px; object-fit: cover; border-radius: 12px; border: 1px solid #eee; }
        .thumbnails { display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap; }
        .thumbnail { width: 80px; height: 80px; object-fit: cover; border-radius: 8px; cursor: pointer; border: 2px solid transparent; transition: all 0.2s; }
        .thumbnail.active, .thumbnail:hover { border-color: #1e88e5; transform: translateY(-2px); }
        
        /* 상품 정보 영역 */
        .prod_view_info { }
        .product-info h1 { font-size: 28px; margin-bottom: 10px; font-weight: 700; color: #222; }
        .product-brand { color: #666; font-size: 16px; margin-bottom: 20px; }
        .product-desc { color: #777; font-size: 14px; margin-bottom: 25px; line-height: 1.5; }
        
        /* 평점 및 리뷰 */
        .rating-section { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
        .stars { color: #ffa726; font-size: 18px; }
        .rating-text { color: #666; font-size: 14px; }
        
        /* 가격 영역 */
        .price-section { background: #f8f9fa; padding: 20px; border-radius: 12px; margin-bottom: 25px; }
        .original-price { font-size: 16px; color: #999; text-decoration: line-through; margin-bottom: 5px; }
        .discount-rate { color: #e74c3c; font-weight: bold; font-size: 18px; margin-bottom: 5px; }
        .current-price { font-size: 24px; color: #e74c3c; font-weight: bold; }
        
        /* 배송 정보 */
        .delivery-info { background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; }
        .delivery-info strong { color: #1976d2; }
        
        /* 옵션 영역 */
        .options-section { margin-bottom: 25px; }
        .option-title { font-weight: 600; margin-bottom: 10px; color: #333; }
        .option-select { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
        
        /* 구매 버튼 */
        .buttons { display: flex; gap: 12px; margin-top: 30px; }
        .btn { flex: 1; padding: 18px; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .cart-btn { background: white; color: #1e88e5; border: 2px solid #1e88e5; }
        .cart-btn:hover { background: #e3f2fd; }
        .buy-btn { background: #1e88e5; color: white; }
        .buy-btn:hover { background: #1565c0; }
        
        /* 판매자 정보 */
        .seller-info { background: #f5f5f5; padding: 15px; border-radius: 8px; margin-top: 20px; font-size: 14px; }
        .seller-info strong { color: #333; }
        
        /* 상세 정보 */
        .detail { margin-top: 60px; }
        .detail h2 { font-size: 24px; margin-bottom: 30px; color: #222; border-bottom: 2px solid #1e88e5; padding-bottom: 10px; }
        .detail-content { text-align: center; padding: 40px; }
        .detail-desc { margin-bottom: 30px; font-size: 16px; color: #666; line-height: 1.6; }
        .detail-images img { max-width: 100%; height: auto; margin-bottom: 30px; border-radius: 8px; }
        
        /* 푸터 */
        #footer_shop_danawa { 
            background: #2c3e50; 
            margin-top: 80px; 
            color: white; 
        }
        .footer-content { 
            max-width: 1200px; 
            margin: 0 auto; 
            padding: 50px 20px 30px; 
        }
        .footer-top { 
            display: grid; 
            grid-template-columns: repeat(4, 1fr); 
            gap: 40px; 
            margin-bottom: 40px; 
        }
        .footer-section h3 { 
            color: #ecf0f1; 
            margin-bottom: 20px; 
            font-size: 18px; 
        }
        .footer-section ul { 
            list-style: none; 
        }
        .footer-section li { 
            margin-bottom: 10px; 
        }
        .footer-section a { 
            color: #bdc3c7; 
            text-decoration: none; 
            cursor: pointer; 
        }
        .footer-section a:hover { 
            color: #ecf0f1; 
        }
        .footer-bottom { 
            border-top: 1px solid #34495e; 
            padding-top: 20px; 
            text-align: center; 
            color: #95a5a6; 
            font-size: 14px; 
        }
        .footer-buttons { 
            display: flex; 
            gap: 15px; 
            justify-content: center; 
            margin-bottom: 20px; 
        }
        .footer-btn { 
            padding: 10px 20px; 
            background: #34495e; 
            color: white; 
            border: none; 
            border-radius: 6px; 
            cursor: pointer; 
            transition: background 0.2s; 
        }
        .footer-btn:hover { 
            background: #4a6741; 
        }
        
        @media (max-width: 768px) {
            .header-nav { display: none; }
            .product-layout { grid-template-columns: 1fr; gap: 30px; }
            .main-image { height: 300px; }
            .thumbnail { width: 60px; height: 60px; }
            .buttons { flex-direction: column; }
            .footer-top { grid-template-columns: repeat(2, 1fr); gap: 30px; }
        }
        
        @media (max-width: 480px) {
            .footer-top { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <header class="main-header__inner">
        <div class="header-content">
            <a href="#" class="header-logo" onclick="alert('메인 페이지'); return false;">ShopMall</a>
            <nav class="header-nav">
                <a href="#" onclick="alert('카테고리'); return false;">카테고리</a>
                <a href="#" onclick="alert('베스트'); return false;">베스트</a>
                <a href="#" onclick="alert('특가'); return false;">특가</a>
                <a href="#" onclick="alert('이벤트'); return false;">이벤트</a>
            </nav>
            <div class="header-utils">
                <span onclick="alert('검색')">🔍</span>
                <span onclick="alert('마이페이지')">👤</span>
                <span onclick="alert('장바구니')">🛒</span>
            </div>
        </div>
    </header>
    
    <div class="container">
        <div class="product-layout">
            <div class="product-images">
                <img id="mainImage" class="main-image" src="${mainImage}" alt="상품 이미지" />
                <div class="thumbnails">
                    ${thumbnails.map((img, idx) => 
                        `<img class="thumbnail ${idx === 0 ? 'active' : ''}" 
                              src="${img}" 
                              onclick="changeImage('${img}', this)" />`
                    ).join('')}
                </div>
            </div>
            
            <div class="prod_view_info">
                <div class="product-brand">브랜드명 (${data.contentId || 'Unknown'})</div>
                <h1>${data.title}</h1>
                ${data.description ? `<div class="product-desc">${data.description}</div>` : ''}
                
                <div class="rating-section">
                    <div class="stars">★★★★☆</div>
                    <span class="rating-text">4.2점 (리뷰 ${Math.floor(Math.random() * 500) + 50}개)</span>
                </div>
                
                <div class="price-section">
                    ${data.listPrice ? `<div class="original-price">정가: ${parseInt(data.listPrice).toLocaleString()}원</div>` : ''}
                    ${data.listPrice && data.customPrice ? `<div class="discount-rate">${Math.round(((parseInt(data.listPrice) - parseInt(data.customPrice)) / parseInt(data.listPrice)) * 100)}% 할인</div>` : ''}
                    <div class="current-price">
                        ${data.customPrice ? `${parseInt(data.customPrice).toLocaleString()}원` : 
                          data.listPrice ? `${parseInt(data.listPrice).toLocaleString()}원` : 
                          '가격 문의'}
                    </div>
                </div>
                
                <div class="delivery-info">
                    <strong>🚚 배송정보:</strong> 무료배송 (2-3일 소요) | 당일발송 가능
                </div>
                
                <div class="options-section">
                    <div class="option-title">옵션 선택</div>
                    <select class="option-select" onclick="alert('옵션 선택')">
                        <option>기본형 (추가금액 없음)</option>
                        <option>고급형 (+5,000원)</option>
                        <option>프리미엄형 (+10,000원)</option>
                    </select>
                </div>
                
                <div class="buttons">
                    <button class="btn cart-btn" onclick="alert('로그인이 필요합니다.')">🛒 장바구니</button>
                    <button class="btn buy-btn" onclick="alert('로그인이 필요합니다.')">💳 바로구매</button>
                </div>
                
                <div class="seller-info">
                    <strong>판매자:</strong> 공식 쇼핑몰 | <strong>평점:</strong> 4.8/5.0 | <strong>문의:</strong> 1588-0000
                </div>
            </div>
        </div>
        
        <div class="detail">
            <h2>상품 상세정보</h2>
            <div class="detail-content">
                ${data.description ? `<div class="detail-desc">${data.description}</div>` : ''}
                <div class="detail-images">
                    ${detailImages.length > 0 
                      ? detailImages.map(img => `<img src="${img}" alt="상품 상세" />`).join('')
                      : `<img src="${mainImage}" alt="상품 상세" />`
                    }
                </div>
            </div>
        </div>
    </div>
    
    <footer id="footer_shop_danawa">
        <div class="footer-content">
            <div class="footer-top">
                <div class="footer-section">
                    <h3>고객센터</h3>
                    <ul>
                        <li><a href="#" onclick="alert('전화상담'); return false;">📞 1588-0000</a></li>
                        <li><a href="#" onclick="alert('채팅상담'); return false;">💬 채팅상담</a></li>
                        <li><a href="#" onclick="alert('FAQ'); return false;">❓ 자주하는질문</a></li>
                        <li><a href="#" onclick="alert('1:1문의'); return false;">📧 1:1문의</a></li>
                    </ul>
                </div>
                <div class="footer-section">
                    <h3>쇼핑정보</h3>
                    <ul>
                        <li><a href="#" onclick="alert('배송안내'); return false;">🚚 배송안내</a></li>
                        <li><a href="#" onclick="alert('교환반품'); return false;">↩️ 교환/반품</a></li>
                        <li><a href="#" onclick="alert('결제안내'); return false;">💳 결제안내</a></li>
                        <li><a href="#" onclick="alert('적립금'); return false;">💰 적립금안내</a></li>
                    </ul>
                </div>
                <div class="footer-section">
                    <h3>회사정보</h3>
                    <ul>
                        <li><a href="#" onclick="alert('회사소개'); return false;">🏢 회사소개</a></li>
                        <li><a href="#" onclick="alert('이용약관'); return false;">📋 이용약관</a></li>
                        <li><a href="#" onclick="alert('개인정보처리방침'); return false;">🔒 개인정보처리방침</a></li>
                        <li><a href="#" onclick="alert('사업자정보'); return false;">📄 사업자정보</a></li>
                    </ul>
                </div>
                <div class="footer-section">
                    <h3>SNS & 앱</h3>
                    <ul>
                        <li><a href="#" onclick="alert('페이스북'); return false;">📘 Facebook</a></li>
                        <li><a href="#" onclick="alert('인스타그램'); return false;">📷 Instagram</a></li>
                        <li><a href="#" onclick="alert('유튜브'); return false;">📹 YouTube</a></li>
                        <li><a href="#" onclick="alert('앱다운로드'); return false;">📱 앱 다운로드</a></li>
                    </ul>
                </div>
            </div>
            
            <div class="footer-buttons">
                <button class="footer-btn" onclick="window.scrollTo(0,0)">⬆️ 맨위로가기</button>
                <button class="footer-btn" onclick="alert('최근본상품')">👁️ 최근본상품</button>
                <button class="footer-btn" onclick="alert('찜한상품')">❤️ 찜한상품</button>
            </div>
            
            <div class="footer-bottom">
                <p>© 2024 ShopMall Corp. All rights reserved. | 대표: 홍길동 | 사업자등록번호: 123-45-67890</p>
                <p>주소: 서울특별시 강남구 테헤란로 123, 샘플빌딩 10층 | 통신판매업신고: 제2024-서울강남-0000호</p>
                <p style="margin-top: 10px; font-size: 12px; color: #7f8c8d;">
                    본 사이트는 데모 페이지입니다. 실제 판매나 거래가 이루어지지 않습니다.
                </p>
            </div>
        </div>
    </footer>
    
    <script>
        function changeImage(src, thumb) {
            document.getElementById('mainImage').src = src;
            document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
        }
    </script>
</body>
</html>`;
}

// 메인 함수
module.exports = async (req, res) => {
  console.log(`${req.method} ${req.url}`);
  
  try {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    // 메인 페이지
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(getMainPageHTML());
    }
    
    // 페이지 생성
    if (req.url === '/generate' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      
      return new Promise((resolve) => {
        req.on('end', async () => {
          try {
            const formData = new URLSearchParams(body);
            const productUrl = formData.get('productUrl');
            const listPrice = formData.get('listPrice') || '';
            const customPrice = formData.get('customPrice') || '';
            
            console.log('Generate request:', { productUrl, listPrice, customPrice });
            
            if (!productUrl) {
              res.setHeader('Content-Type', 'application/json');
              res.status(400).json({ error: 'productUrl is required', message: '다나와 URL을 입력해주세요.' });
              resolve();
              return;
            }
            
            // 다나와 스크래핑 실행
            let scrapedData = null;
            if (productUrl.includes('danawa.com')) {
              scrapedData = await scrapeDanawa(productUrl);
            }
            
            if (!scrapedData || !scrapedData.title || scrapedData.images.length === 0) {
              res.setHeader('Content-Type', 'application/json');
              res.status(400).json({ error: 'Scraping failed', message: '스크래핑에 실패했습니다. URL을 확인해주세요.' });
              resolve();
              return;
            }
            
            // content_id 자동 생성
            const contentId = generateId(8).toUpperCase();
            
            // 구글 시트에 저장할 데이터 준비
            const sheetData = {
              content_id: contentId,
              product_name: scrapedData.title,
              product_desc: scrapedData.description,
              thumb_img_url: scrapedData.images.slice(0, 4).join(','), // 썸네일 최대 4개
              product_img_url: scrapedData.images.slice(4).join(',') // 나머지는 상세이미지
            };
            
            // TODO: 구글 시트에 자동 저장 (현재는 로깅만)
            console.log('=== 구글 시트에 저장할 데이터 ===');
            console.log(`A: ${sheetData.content_id}`);
            console.log(`B: ${sheetData.product_name}`);
            console.log(`C: ${sheetData.product_desc}`);
            console.log(`D: ${sheetData.thumb_img_url}`);
            console.log(`E: ${sheetData.product_img_url}`);
            console.log('================================');
            
            const pageData = {
              title: scrapedData.title,
              description: scrapedData.description,
              listPrice: listPrice.replace(/[^0-9]/g, ''),
              customPrice: customPrice.replace(/[^0-9]/g, ''),
              images: scrapedData.images,
              contentId: contentId,
              sheetData: sheetData // 디버깅용
            };
            
            const encodedData = urlSafeBase64Encode(pageData);
            const productLink = `${req.headers.origin || 'https://' + req.headers.host}/p/${encodedData}`;
            
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json({ 
              link: productLink, 
              success: true,
              contentId: contentId,
              message: `스크래핑 완료! content_id: ${contentId}`,
              sheetData: sheetData
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
    const productMatch = req.url.match(/^\/p\/([A-Za-z0-9\-_]+)$/);
    if (productMatch) {
      const encodedData = productMatch[1];
      const data = urlSafeBase64Decode(encodedData);
      
      if (!data) {
        res.setHeader('Content-Type', 'text/html');
        return res.status(404).send('<h1>404 - 잘못된 링크입니다</h1><p><a href="/">메인 페이지로 이동</a></p>');
      }
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(getProductPageHTML(data));
    }
    
    // 404
    res.setHeader('Content-Type', 'text/html');
    res.status(404).send('<h1>404 - 페이지를 찾을 수 없습니다</h1><p><a href="/">메인 페이지로 이동</a></p>');
    
  } catch (error) {
    console.error('Function error:', error);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
};
