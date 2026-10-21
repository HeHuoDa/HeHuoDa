# Bridge registered Web History URLs, including an optional trailing slash.
js_import legacy from /etc/nginx/legacy.mjs;
location ~ ^/(?:home(?:/competitions/[A-Za-z0-9-]+)?|teams(?:/[A-Za-z0-9-]+)?|profile|my/(?:teams|applications|favorites)|notifications|about|login|register|health)/?$ {
    js_content legacy.redirect;
}
