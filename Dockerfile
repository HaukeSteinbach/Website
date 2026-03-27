FROM nginx:1.27-alpine

WORKDIR /tmp/site

COPY . .

RUN rm -rf /usr/share/nginx/html/* \
    && if [ -d /tmp/site/website ]; then \
        cp -a /tmp/site/website/. /usr/share/nginx/html/; \
    else \
        cp -a /tmp/site/assets /usr/share/nginx/html/ \
        && find /tmp/site -maxdepth 1 -name '*.html' -exec cp -a {} /usr/share/nginx/html/ \; ; \
    fi \
    && rm -rf /tmp/site

EXPOSE 80