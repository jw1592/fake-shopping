const axios = require('axios');
const cheerio = require('cheerio');

async function testScrapeDanawa(productUrl) {
  try {
    console.log('Testing scraping for:', productUrl);
    
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
    
    console.log('Response status:', response.status);
    console.log('Response length:', response.data.length);
    
    const $ = cheerio.load(response.data);
    
    // 제목 추출 (더 많은 방법 시도)
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
          console.log(`Title found with selector "${selector}":`, title.substring(0, 100));
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
        console.log('OG Image found:', img);
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
          console.log('Thumbnail found:', src);
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
          console.log('Detail image found:', src);
        }
      }
    });
    
    // 일반적인 이미지 태그들도 확인
    $('img').each((_, el) => {
      const img = $(el);
      let src = img.attr('src') || img.attr('data-src');
      if (src && src.includes('prod') && src.startsWith('http')) {
        images.push(src);
        console.log('Product image found:', src);
      }
    });
    
    const uniqueImages = [...new Set(images)].slice(0, 10);
    
    // 상품 설명 추출
    let description = $('.prod_view_head').text().trim();
    if (!description) {
      description = $('.product_desc, .goods_desc').first().text().trim();
    }
    
    const result = {
      title: title || '제목을 찾을 수 없음',
      images: uniqueImages,
      description: description.substring(0, 200),
      listPrice: '',
      totalImages: images.length,
      uniqueImages: uniqueImages.length
    };
    
    console.log('Final result:', result);
    return result;
    
  } catch (error) {
    console.error('Scraping error:', error.message);
    console.error('Error details:', error.response?.status, error.response?.statusText);
    return {
      title: '스크래핑 오류: ' + error.message,
      images: [],
      description: '',
      error: error.message
    };
  }
}

// 테스트 실행
const testUrl = 'https://shop.danawa.com/main/?controller=goods&methods=blog&type=blog&productSeq=9589341';
testScrapeDanawa(testUrl);
