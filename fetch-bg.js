import https from 'https';
https.get('https://21st.dev/r/kokonutd/background-paths', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log(data));
});
