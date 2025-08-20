const path = require('path');
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

// ID 생성 함수
function generateId(length = 8) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

const app = express();
const PORT = process.env.PORT || 3000;

// 로컬 환경 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets')));

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

// 다나와 파서
function parseDanawa(html, productUrl) {
  const $ = cheerio.load(html);
  
  // 제목 추출
  const titleOg = $("meta[property='og:title']").attr('content') || '';
  const titleH1 = $('h1, h2, .prod_tit, .product_title').first().text().trim();
  const prodViewHead = $('.prod_view_head').text().trim();
  
  // 더 풍성한 제목 선택
  const titleCandidates = [titleOg, titleH1, prodViewHead].filter(Boolean);
  const fullTitle = titleCandidates.length > 0 
    ? titleCandidates.reduce((longest, current) => current.length > longest.length ? current : longest)
    : '상품명 추출 실패';
  
  // 제목과 설명 분리
  let title = '';
  let description = '';
  
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
  
  // 가격 추출
  const priceText = $('.price, .prod_price, [class*="price"]').first().text().replace(/[^0-9]/g, '');
  
  // 이미지 수집
  const imageCandidates = [];
  
  // 1) og:image 메타태그
  $("meta[property='og:image']").each((_, el) => {
    const u = $(el).attr('content');
    if (u) imageCandidates.push(u);
  });
  
  // 2) 섬네일 이미지들
  $('.prod_view_thumb img').each((_, el) => {
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
        const absolute = src.startsWith('http') ? src : new URL(src, productUrl).toString();
        if (/\.(jpg|jpeg|png|webp|gif)/i.test(absolute)) {
          imageCandidates.push(absolute);
        }
      } catch (e) {
        // ignore invalid URLs
      }
    });
  });
  
  // 3) 상세 이미지들
  $('.prod_con_img img').each((_, el) => {
    const img = $(el);
    const src = img.attr('src') || img.attr('data-src') || img.attr('data-original');
    if (src) {
      try {
        const absolute = src.startsWith('http') ? src : new URL(src, productUrl).toString();
        if (/\.(jpg|jpeg|png|webp|gif)/i.test(absolute)) {
          imageCandidates.push(absolute);
        }
      } catch (e) {
        // ignore
      }
    }
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
  console.log('다나와 스크래핑 시도:', productUrl);
  try {
    const { data: html } = await axios.get(productUrl, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'referer': 'https://www.google.com/'
      },
      timeout: 20000,
      validateStatus: () => true
    });
    console.log('다나와 응답 길이:', html.length);
    return parseDanawa(html, productUrl);
  } catch (error) {
    console.error('다나와 스크래핑 오류:', error.message);
    return { title: '', listPrice: '', salePrice: '', images: [], descriptionHtml: '' };
  }
}

// 라우트들
app.get('/', (req, res) => {
  console.log('메인 페이지 요청');
  res.render('index');
});

app.post('/generate', async (req, res) => {
  console.log('페이지 생성 요청:', req.body);
  
  try {
    const { productUrl } = req.body;
    const userListPriceRaw = (req.body.listPrice || '').toString();
    const userCustomPriceRaw = (req.body.customPrice || req.body.targetPrice || '').toString();
    const manualTitle = (req.body.manualTitle || '').toString().trim();

    const site = detectSite(productUrl);
    console.log('감지된 사이트:', site);

    let scraped = { title: '', listPrice: '', salePrice: '', images: [], descriptionHtml: '', description: '' };
    
    // 스크래핑 시도
    if (productUrl) {
      console.log('상품 정보 스크래핑 시도...');
      if (site === 'danawa') {
        scraped = await scrapeDanawa(productUrl);
      }
      console.log('스크래핑 결과:', {
        title: scraped.title,
        images: scraped.images.length,
        description: scraped.description ? scraped.description.substring(0, 100) + '...' : 'None'
      });
    }

    const id = generateId(8);
    
    // 이미지 처리
    let finalImages = [];
    if (scraped.images && scraped.images.length > 0) {
      finalImages = scraped.images;
      console.log('✅ 스크래핑 이미지 사용:', scraped.images.length + '개');
    } else {
      finalImages = ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Product+Image'];
      console.log('⚠️ 플레이스홀더 이미지 사용');
    }

    // 상세 콘텐츠 처리
    let finalDescriptionHtml = '';
    if (scraped.descriptionHtml && scraped.descriptionHtml.trim()) {
      finalDescriptionHtml = scraped.descriptionHtml;
      console.log('✅ 스크래핑 상세 콘텐츠 사용');
    } else if (finalImages[0] !== 'https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Product+Image') {
      finalDescriptionHtml = `<div style="text-align:center; padding:40px;">
           <img src="${finalImages[0]}" style="max-width:100%; height:auto; border-radius:8px;" alt="상품 상세 이미지" />
           <p style="margin-top:20px; color:#666; font-size:14px;">상품 이미지 (자동 추출)</p>
         </div>`;
      console.log('📷 이미지 기반 상세 콘텐츠 생성');
    } else {
      finalDescriptionHtml = '<div style="text-align:center; padding:40px; color:#666;">상품 상세 정보를 불러올 수 없습니다.</div>';
      console.log('❌ 기본 상세 콘텐츠 사용');
    }

    const pageData = {
      id,
      template: 'naver',
      productUrl,
      title: manualTitle || scraped.title || '상품명(미확인)',
      description: scraped.description || '',
      listPrice: (userListPriceRaw || scraped.listPrice || '').toString().replace(/[^0-9]/g, ''),
      customPrice: userCustomPriceRaw.toString().replace(/[^0-9]/g, ''),
      images: finalImages,
      descriptionHtml: finalDescriptionHtml
    };
    
    pageStore.set(id, pageData);
    console.log('페이지 데이터 저장됨, ID:', id);

    res.json({ 
      id, 
      link: `${req.protocol}://${req.get('host')}/p/${id}`,
      success: true 
    });
    
  } catch (err) {
    console.error('생성 오류:', err);
    
    // 실패 시 기본 페이지 생성
    const id = generateId(8);
    const pageData = {
      id,
      template: 'naver',
      productUrl: req.body.productUrl || '',
      title: req.body.manualTitle?.trim() || '상품명(사용자 입력 권장)',
      description: '',
      listPrice: (req.body.listPrice || '').toString().replace(/[^0-9]/g, ''),
      customPrice: (req.body.customPrice || req.body.targetPrice || '').toString().replace(/[^0-9]/g, ''),
      images: ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Fallback+Image'],
      descriptionHtml: '<div style="text-align:center; padding:40px; color:#666;">스크래핑에 실패했습니다.</div>'
    };
    
    pageStore.set(id, pageData);
    res.json({ 
      id, 
      link: `${req.protocol}://${req.get('host')}/p/${id}`, 
      fallback: true 
    });
  }
});

app.get('/p/:id', (req, res) => {
  console.log('상품 페이지 요청, ID:', req.params.id);
  
  try {
    const data = pageStore.get(req.params.id);
    if (!data) {
      console.log('페이지 데이터를 찾을 수 없음:', req.params.id);
      return res.status(404).send('페이지가 존재하지 않습니다.');
    }
    
    console.log('페이지 렌더링:', data.title);
    res.render('templates/naver', { data });
  } catch (error) {
    console.error('페이지 렌더링 오류:', error);
    res.status(500).send('페이지 렌더링 중 오류가 발생했습니다.');
  }
});

// 404 핸들러
app.use((req, res) => {
  console.log('404 - 페이지를 찾을 수 없음:', req.url);
  res.status(404).send('페이지를 찾을 수 없습니다.');
});

// 전역 에러 핸들러
app.use((err, req, res, next) => {
  console.error('서버 오류:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: err.message
  });
});

// 서버 시작
app.listen(PORT, () => {
  console.log('\n🎉 로컬 서버가 시작되었습니다!');
  console.log(`🌍 접속 URL: http://localhost:${PORT}`);
  console.log(`📁 Views 경로: ${path.join(__dirname, 'views')}`);
  console.log(`📁 Assets 경로: ${path.join(__dirname, 'assets')}`);
  console.log('\n테스트 방법:');
  console.log('1. http://localhost:3000/ 에서 메인 페이지 확인');
  console.log('2. 다나와 URL 입력하여 페이지 생성 테스트');
  console.log('3. Ctrl+C 로 서버 종료\n');
});
