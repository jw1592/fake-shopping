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
            const result = document.getElementById('result');
            
            try {
                result.innerHTML = '<div>페이지를 생성하고 있습니다...</div>';
                
                const response = await fetch('/generate', {
                    method: 'POST',
                    body: formData
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
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        .header { background: #fff; border-bottom: 1px solid #eee; padding: 10px 20px; }
        .naver-logo { color: #03c75a; font-weight: bold; font-size: 24px; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .product-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
        .main-image { width: 100%; height: 400px; object-fit: cover; border-radius: 8px; }
        .thumbnails { display: flex; gap: 10px; margin-top: 15px; }
        .thumbnail { width: 80px; height: 80px; object-fit: cover; border-radius: 4px; cursor: pointer; border: 2px solid transparent; }
        .thumbnail.active, .thumbnail:hover { border-color: #03c75a; }
        .product-info h1 { font-size: 24px; margin-bottom: 20px; }
        .price { font-size: 20px; color: #e74c3c; font-weight: bold; margin: 20px 0; }
        .buttons { display: flex; gap: 10px; margin-top: 30px; }
        .btn { flex: 1; padding: 15px; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; }
        .cart-btn { background: white; color: #03c75a; border: 2px solid #03c75a; }
        .buy-btn { background: #03c75a; color: white; }
        .detail { margin-top: 40px; }
        .detail h2 { margin-bottom: 20px; }
        .footer { background: #f8f9fa; margin-top: 60px; padding: 40px 0; text-align: center; }
        
        @media (max-width: 768px) {
            .product-layout { grid-template-columns: 1fr; }
            .main-image { height: 300px; }
            .thumbnail { width: 60px; height: 60px; }
            .buttons { flex-direction: column; }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="naver-logo">NAVER</div>
    </div>
    
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
            
            <div class="product-info">
                <h1>${data.title}</h1>
                ${data.description ? `<p>${data.description}</p>` : ''}
                ${data.listPrice ? `<div class="price">정가: ${parseInt(data.listPrice).toLocaleString()}원</div>` : ''}
                ${data.customPrice ? `<div class="price">특가: ${parseInt(data.customPrice).toLocaleString()}원</div>` : ''}
                
                <div class="buttons">
                    <button class="btn cart-btn" onclick="alert('로그인이 필요합니다.')">장바구니</button>
                    <button class="btn buy-btn" onclick="alert('로그인이 필요합니다.')">구매하기</button>
                </div>
            </div>
        </div>
        
        <div class="detail">
            <h2>상품 상세정보</h2>
            <div style="text-align: center; padding: 40px;">
                ${data.description ? `<p style="margin-bottom: 30px; font-size: 16px; color: #666;">${data.description}</p>` : ''}
                ${detailImages.length > 0 
                  ? detailImages.map(img => `<img src="${img}" style="max-width: 100%; height: auto; margin-bottom: 20px; display: block;" alt="상품 상세" />`).join('')
                  : `<img src="${mainImage}" style="max-width: 100%; height: auto;" alt="상품 상세" />`
                }
            </div>
        </div>
    </div>
    
    <div class="footer">
        <p>© NAVER Corp. (데모 페이지)</p>
        <button onclick="window.scrollTo(0,0)" style="margin-top: 10px; padding: 10px 20px; background: #03c75a; color: white; border: none; border-radius: 4px;">맨위로가기</button>
    </div>
    
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
