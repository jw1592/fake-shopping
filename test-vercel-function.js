// Vercel 함수를 로컬에서 테스트하기 위한 래퍼
const http = require('http');
const url = require('url');
const querystring = require('querystring');

// Vercel 함수 import
const vercelFunction = require('./api/index-new.js');

const server = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);
  
  try {
    // Vercel 함수 호출
    await vercelFunction(req, res);
  } catch (error) {
    console.error('Function error:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: error.message }));
    }
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log('\n🧪 Vercel 함수 테스트 서버 시작!');
  console.log(`🌍 테스트 URL: http://localhost:${PORT}`);
  console.log('🔍 이 서버는 Vercel 환경과 동일한 방식으로 작동합니다.\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n서버를 종료합니다...');
  server.close();
  process.exit(0);
});
