# The API prefix is never handled by the SPA fallback.
absolute_redirect off;
location = /api { return 404; }
location = /_health { access_log off; return 200 "ok\n"; }
location ^~ /api/ {
    proxy_pass http://api:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
    add_header Cache-Control "no-store" always;
}

# Production documentation is disabled in the API as well.
location = /docs { return 404; }
location /docs/ { return 404; }
location = /docs-json { return 404; }
location ~ /\. { return 404; }
location = /index.html { add_header Cache-Control "no-store" always; }
location ~* "^/(?:assets|static)/.*[.-][a-z0-9_-]{8}\.(?:js|css|woff2?|png|jpe?g|webp|svg)$" {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
location /assets/ { try_files $uri =404; }
location /static/ { try_files $uri =404; }
location ~* \.(?:js|mjs|css|map|json|png|jpe?g|gif|svg|ico|woff2?|ttf|webp|avif|txt|xml|html)$ {
    try_files $uri =404;
    add_header Cache-Control "no-cache";
}
location / { try_files $uri $uri/ /index.html; }
include /etc/nginx/legacy-routes.inc;
