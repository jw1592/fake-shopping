const path = require('path');
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
// const { nanoid } = require('nanoid'); // ESM 오류로 인해 주석 처리
// Node.js 내장 crypto 모듈 사용
const crypto = require('crypto');

// nanoid 대체 함수
function generateId(length = 8) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}
// Puppeteer removed for Vercel compatibility

const app = express();
const PORT = process.env.PORT || 3000;

// Vercel 환경 대응
const isVercel = process.env.VERCEL || process.env.NODE_ENV === 'production';
const viewsPath = isVercel ? path.join(process.cwd(), 'views') : path.join(__dirname, '../views');
const assetsPath = isVercel ? path.join(process.cwd(), 'assets') : path.join(__dirname, '../assets');

app.set('view engine', 'ejs');
app.set('views', viewsPath);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/assets', express.static(assetsPath));

// In-memory store (simple)
const pageStore = new Map();

const SUPPORTED_TEMPLATES = { naver: 'naver' };

function absolutizeUrl(url, baseUrl) {
  if (!url) return '';
  try {
    if (url.startsWith('//')) return `https:${url}`;
    return url.startsWith('http') ? url : new URL(url, baseUrl).toString();
  } catch (_) {
    return url;
  }
}

function normalizeDescriptionHtml(rawHtml, baseUrl) {
  if (!rawHtml) return '';
  try {
    const $ = cheerio.load(rawHtml, { decodeEntities: false });
    $('script, noscript').remove();
    $('iframe').remove();

    $('img').each((_, el) => {
      const img = $(el);
      const candidates = [
        img.attr('src'),
        img.attr('data-src'),
        img.attr('data-original'),
        img.attr('data-lazy'),
        img.attr('data-lazy-src')
      ].filter(Boolean);
      let chosen = candidates.find(u => /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(u)) || candidates[0];
      if (chosen) {
        chosen = absolutizeUrl(chosen, baseUrl);
        img.attr('src', chosen);
      }
      const srcset = img.attr('srcset');
      if (srcset) {
        const rebuilt = srcset.split(',').map(s => {
          const [u, d] = s.trim().split(/\s+/);
          const abs = absolutizeUrl(u, baseUrl);
          return d ? `${abs} ${d}` : abs;
        }).join(', ');
        img.attr('srcset', rebuilt);
      }
      img.removeAttr('loading');
      img.removeAttr('width');
      img.removeAttr('height');
      img.removeAttr('data-src');
      img.removeAttr('data-original');
      img.removeAttr('data-lazy');
      img.removeAttr('data-lazy-src');
      // 인라인 style 내 width/height 제거
      const style = img.attr('style') || '';
      if (style) {
        const cleaned = style
          .replace(/width\s*:\s*[^;]+;?/ig, '')
          .replace(/height\s*:\s*[^;]+;?/ig, '')
          .trim();
        if (cleaned) img.attr('style', cleaned); else img.removeAttr('style');
      }
    });

    $('a').each((_, el) => {
      const a = $(el);
      const href = a.attr('href');
      if (href) {
        a.attr('href', absolutizeUrl(href, baseUrl));
        a.attr('target', '_blank');
        a.attr('rel', 'noopener');
      }
      // 이벤트 속성 제거
      ['onclick','onmouseover','onmouseout','onload'].forEach(evt => a.removeAttr(evt));
    });

    // style 속성 내 url(...) 상대경로 절대경로화
    $('[style]').each((_, el) => {
      const node = $(el);
      const style = node.attr('style');
      if (!style) return;
      const rewritten = style.replace(/url\((['\"]?)([^)'"\s]+)\1\)/ig, (m, q, u) => {
        const abs = absolutizeUrl(u, baseUrl);
        return `url(${abs})`;
      });
      node.attr('style', rewritten);
      // 인라인 이벤트 제거
      ['onclick','onmouseover','onmouseout','onload'].forEach(evt => node.removeAttr(evt));
    });

    // <style> 태그 내부 url(...) 절대경로화
    $('style').each((_, el) => {
      const styleNode = $(el);
      const css = styleNode.html() || '';
      if (!css) return;
      const rewritten = css.replace(/url\((['\"]?)([^)'"\s]+)\1\)/ig, (m, q, u) => {
        const abs = absolutizeUrl(u, baseUrl);
        return `url(${abs})`;
      });
      styleNode.text(rewritten);
    });

    // 오류 안내 문구 제거 (네이버 안내 페이지 조각)
    const notFoundPatterns = [
      /상품이 존재하지 않습니다/i,
      /페이지를 찾을 수 없습니다/i,
      /삭제되었거나 변경/i,
      /이전 페이지로 가기/i
    ];
    $('body *').each((_, el) => {
      const text = $(el).text().trim();
      if (!text) return;
      if (notFoundPatterns.some((re) => re.test(text))) {
        $(el).remove();
      }
    });

    // 반환은 body 내부만 (중첩 HTML 방지)
    const body = $('body');
    if (body && body.length) {
      return body.html() || '';
    }
    return $.root().html() || '';
  } catch (_) {
    return rawHtml;
  }
}

function containsNotFoundMessage(html) {
  if (!html) return false;
  const lowered = html.toLowerCase();
  return (
    lowered.includes('상품이 존재하지 않습니다') ||
    lowered.includes('페이지를 찾을 수 없습니다') ||
    lowered.includes('이전 페이지로 가기') ||
    lowered.includes('삭제되었거나 변경') ||
    lowered.includes('현재 서비스 접속이 불가합니다') ||
    lowered.includes('동시에 접속하는 이용자 수가 많거나') ||
    lowered.includes('에러페이지') ||
    lowered.includes('module_error') ||
    lowered.includes('새로고침')
  );
}

function detectSite(url) {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('naver.com') || lower.includes('smartstore.naver')) return 'naver';
  if (lower.includes('danawa.com') || lower.includes('shop.danawa')) return 'danawa';
  return 'danawa'; // 기본값을 다나와로 변경
}

// 다나와 파서 추가
function parseDanawa(html, productUrl) {
  const $ = cheerio.load(html);
  
  // 제목 추출 - prod_view_head 클래스도 활용
  const titleOg = $("meta[property='og:title']").attr('content') || '';
  const titleH1 = $('h1, h2, .prod_tit, .product_title').first().text().trim();
  const prodViewHead = $('.prod_view_head').text().trim();
  
  // 상품명과 상품설명 분리
  let title = '';
  let description = '';
  
  // 더 풍성한 제목 선택 (긴 것 우선)
  const titleCandidates = [titleOg, titleH1, prodViewHead].filter(Boolean);
  const fullTitle = titleCandidates.length > 0 
    ? titleCandidates.reduce((longest, current) => current.length > longest.length ? current : longest)
    : '상품명 추출 실패';
  
  // 제목에서 상품명과 설명 분리 시도
  if (fullTitle.includes('(') && fullTitle.includes(')')) {
    // 괄호가 있는 경우 - 괄호 앞을 상품명, 괄호 내용을 설명으로
    const parts = fullTitle.split('(');
    title = parts[0].trim();
    description = '(' + parts.slice(1).join('(').trim();
  } else if (fullTitle.includes('/')) {
    // 슬래시로 구분된 경우
    const parts = fullTitle.split('/');
    title = parts[0].trim();
    description = parts.slice(1).join(' / ').trim();
  } else {
    // 분리할 수 없는 경우 전체를 상품명으로
    title = fullTitle;
    // 상품 사양 정보 추출 시도
    const specText = $('.prod_spec, .spec_list, .product_spec').first().text().trim();
    if (specText) {
      description = specText.substring(0, 200) + (specText.length > 200 ? '...' : '');
    }
  }
  
  // 가격 추출 - 다나와 특성상 여러 형태의 가격이 있을 수 있음
  const priceText = $('.price, .prod_price, [class*="price"]').first().text().replace(/[^0-9]/g, '');
  
  // 이미지 수집
  const imageCandidates = [];
  
  // 1) og:image 메타태그
  $("meta[property='og:image']").each((_, el) => {
    const u = $(el).attr('content');
    if (u) imageCandidates.push(u);
  });
  
  // 2) 섬네일 이미지들 (prod_view_thumb)
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
  
  // 3) 일반 상품 이미지들
  const isDanawaImg = (url) => /danawa\.com|img\.danawa/i.test(url);
  $('img').each((_, el) => {
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
        if (/\.(jpg|jpeg|png|webp|gif)/i.test(absolute) && isDanawaImg(absolute)) {
          imageCandidates.push(absolute);
        }
      } catch (e) {
        // ignore invalid URLs
      }
    });
  });
  
  // 4) 상세 이미지들 (prod_con_img)
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
  
  // 상세 설명 HTML 추출
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

function parseNaver(html, productUrl) {
  const $ = cheerio.load(html);
  const titleOg = $("meta[property='og:title']").attr('content') || $("meta[name='twitter:title']").attr('content') || '';
  const title = (titleOg || $('h1, h2, h3').filter((_, el) => $(el).text().trim().length > 0).first().text().trim());
  const listPriceText = $('[class*="price" i]').first().text().replace(/[^0-9]/g, '');

  // 이미지 수집 재활성화
  const imageCandidates = [];
  
  // 1) og:image 메타태그 수집
  $("meta[property='og:image']").each((_, el) => {
    const u = $(el).attr('content');
    if (u) imageCandidates.push(u);
  });
  
  // 2) 모든 img 태그에서 네이버 도메인 이미지 수집
  const isNaverImg = (url) => /pstatic\.net|shop-phinf|shopping-phinf|static\.naver|cdn\.naver|blogfiles\.naver/i.test(url);
  
  $('img').each((_, el) => {
    const img = $(el);
    const candidates = [
      img.attr('src'),
      img.attr('data-src'),
      img.attr('data-original'), 
      img.attr('data-lazy'),
      img.attr('data-lazy-src'),
      img.attr('data-origin'),
      img.attr('data-thumb'),
      img.attr('data-large'),
      img.attr('data-zoom')
    ].filter(Boolean);
    
    candidates.forEach(src => {
      try {
        const absolute = src.startsWith('http') ? src : new URL(src, productUrl).toString();
        if (isNaverImg(absolute) && /\.(jpg|jpeg|png|webp|gif)/i.test(absolute)) {
          imageCandidates.push(absolute);
        }
      } catch (e) {
        // ignore invalid URLs
      }
    });
  });
  
  // 3) se-main-container 내부 이미지도 수집
  const seContainer = $('.se-main-container').first();
  if (seContainer.length) {
    seContainer.find('img').each((_, el) => {
      const img = $(el);
      const src = img.attr('src') || img.attr('data-src') || img.attr('data-original');
      if (src) {
        try {
          const absolute = src.startsWith('http') ? src : new URL(src, productUrl).toString();
          if (isNaverImg(absolute)) {
            imageCandidates.push(absolute);
          }
        } catch (e) {
          // ignore
        }
      }
    });
  }

  const descHtml = ($('.se-main-container, [data-nv-handle="PRODUCT_DETAIL"], #INTRODUCE, #info, #content, #INTRODUCE div').first().html() || '');
  const uniqueImages = Array.from(new Set(imageCandidates)).slice(0, 10);

  return {
    title: title || '상품명 추출 실패',
    listPrice: listPriceText || '',
    salePrice: '',
    images: uniqueImages,
    descriptionHtml: descHtml
  };
}

async function scrapeDanawa(productUrl) {
  const { data: html } = await axios.get(productUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'referer': 'https://www.google.com/'
    },
    timeout: 20000,
    validateStatus: () => true
  });
  return parseDanawa(html, productUrl);
}

async function scrapeNaver(productUrl) {
  const { data: html } = await axios.get(productUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'referer': 'https://www.google.com/'
    },
    timeout: 20000,
    validateStatus: () => true
  });
  return parseNaver(html, productUrl);
}

async function scrapeOpenGraph(productUrl) {
  const { data: html } = await axios.get(productUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    timeout: 15000,
    validateStatus: () => true
  });
  const $ = cheerio.load(html);
  const title = $("meta[property='og:title']").attr('content') || $("meta[name='twitter:title']").attr('content') || '';
  const image = $("meta[property='og:image']").attr('content') || '';
  const price = $("meta[property='product:price:amount']").attr('content') || '';
  return {
    title: title || '상품명(미확인)',
    listPrice: price.replace(/[^0-9]/g, ''),
    salePrice: '',
    images: image ? [image] : [], // og:image 사용
    descriptionHtml: ''
  };
}

async function scrapeWithPuppeteer(productUrl, site) {
  // Vercel 환경에서는 Puppeteer 사용 안 함
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    console.log('[Puppeteer] 프로덕션 환경에서는 Puppeteer를 사용하지 않습니다.');
    return { title: '제목 추출 실패', listPrice: '', salePrice: '', images: [], descriptionHtml: '' };
  }

  // Puppeteer package removed for Vercel compatibility
  console.log('[Puppeteer] Package not available in production');
  return { title: '제목 추출 실패', listPrice: '', salePrice: '', images: [], descriptionHtml: '' };

}

app.get('/', (req, res) => {
  res.render('index');
});

app.post('/generate', async (req, res) => {
  try {
    const { productUrl, template } = req.body;
    const userListPriceRaw = (req.body.listPrice || '').toString();
    const userCustomPriceRaw = (req.body.customPrice || req.body.targetPrice || '').toString();
    const manualTitle = (req.body.manualTitle || '').toString().trim();

    const site = detectSite(productUrl);

    let scraped = { title: '', listPrice: '', salePrice: '', images: [], descriptionHtml: '' };
    
    // 스크래핑 시도
    console.log('상품 정보 스크래핑을 시도합니다...');
    try {
      if (site === 'danawa') {
        scraped = await scrapeDanawa(productUrl);
      } else {
        scraped = await scrapeNaver(productUrl);
      }
      
      if (!scraped.title || (!scraped.images || scraped.images.length === 0) || containsNotFoundMessage(scraped.descriptionHtml)) {
        console.log('1차 스크래핑 실패. Puppeteer로 재시도...');
        scraped = await scrapeWithPuppeteer(productUrl, site);
      }
    } catch (e) {
      console.log('Puppeteer 실패. OpenGraph로 재시도...');
      try {
        scraped = await scrapeOpenGraph(productUrl);
      } catch (_) {
        console.log('모든 스크래핑 실패. 기본값 사용.');
      }
    }

    const id = generateId(8);
    // 이미지와 상세 콘텐츠 처리
    let finalImages = [];
    let finalDescriptionHtml = '';

    // 스크래핑된 이미지 사용 또는 플레이스홀더
    if (scraped.images && scraped.images.length > 0) {
      finalImages = scraped.images; // 모든 이미지 사용 (썸네일 갤러리용)
      console.log('✅ 스크래핑 이미지 사용:', scraped.images.length + '개');
    } else {
      finalImages = ['https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Product+Image'];
      console.log('⚠️ 플레이스홀더 이미지 사용');
    }

    // 스크래핑된 상세 콘텐츠 사용 또는 이미지 기반 콘텐츠
    if (scraped.descriptionHtml && scraped.descriptionHtml.trim() && !containsNotFoundMessage(scraped.descriptionHtml)) {
      finalDescriptionHtml = scraped.descriptionHtml;
      console.log('✅ 스크래핑 상세 콘텐츠 사용, 길이:', scraped.descriptionHtml.length);
    } else if (finalImages[0] !== 'https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Product+Image') {
      // 상품 이미지를 큰 사이즈로 표시
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
      images: finalImages, // 스크래핑 또는 수동 입력 이미지
      descriptionHtml: finalDescriptionHtml // 스크래핑 또는 이미지 기반 상세 콘텐츠
    };
    pageStore.set(id, pageData);

    res.json({ id, link: `${req.protocol}://${req.get('host')}/p/${id}` });
  } catch (err) {
    console.error(err);
    // 실패해도 수동 입력 기반으로 페이지를 생성해 성공 응답을 보낸다
    const id = generateId(8);
    const fallbackGalleryImages = [
      'https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Fallback+Image+1',
      'https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Fallback+Image+2',
      'https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Fallback+Image+3',
      'https://via.placeholder.com/500x500/f8f9fa/6c757d?text=Fallback+Image+4'
    ];
    
    const fallbackImages = fallbackGalleryImages;
    const fallbackContent = '<div style="text-align:center; padding:40px; color:#666;">스크래핑에 실패했습니다.</div>';
    
    const pageData = {
      id,
      template: 'naver',
      productUrl: req.body.productUrl || '',
      title: req.body.manualTitle?.trim() || '상품명(사용자 입력 권장)',
      listPrice: (req.body.listPrice || '').toString().replace(/[^0-9]/g, ''),
      customPrice: (req.body.customPrice || req.body.targetPrice || '').toString().replace(/[^0-9]/g, ''),
      images: fallbackImages,
      descriptionHtml: fallbackContent
    };
    pageStore.set(id, pageData);
    return res.json({ id, link: `${req.protocol}://${req.get('host')}/p/${id}`, fallback: true });
  }
});

app.get('/p/:id', (req, res) => {
  try {
    const data = pageStore.get(req.params.id);
    if (!data) return res.status(404).send('페이지가 존재하지 않습니다.');
    res.render('templates/naver', { data });
  } catch (error) {
    console.error('페이지 렌더링 오류:', error);
    res.status(500).send('페이지 렌더링 중 오류가 발생했습니다.');
  }
});

// 404 핸들러
app.use((req, res) => {
  res.status(404).send('페이지를 찾을 수 없습니다.');
});

// 전역 에러 핸들러
app.use((err, req, res, next) => {
  console.error('서버 오류:', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? '서버 오류가 발생했습니다.' : err.message
  });
});

// Vercel에서는 module.exports 사용
if (isVercel) {
  module.exports = app;
} else {
  app.listen(PORT, () => {
    console.log(`Fake shopping server listening on http://localhost:${PORT}`);
  });
}


