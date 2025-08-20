// 가장 간단한 Vercel 서버리스 함수 테스트
module.exports = (req, res) => {
  console.log('Test function called');
  res.status(200).json({ 
    message: '테스트 성공!', 
    timestamp: new Date().toISOString(),
    url: req.url,
    method: req.method
  });
};
