FROM couchdb:3

# Bake our config and entrypoint shim into the image so nothing is bind-mounted
# at runtime. The stock entrypoint does a recursive chown across /opt/couchdb
# which explodes on read-only bind mounts; in-image files are writable and
# stay untouched on the host.
COPY local.ini /opt/couchdb/etc/local.d/tricho.ini
COPY entrypoint.sh /opt/couchdb/tricho-entrypoint.sh
RUN chmod +x /opt/couchdb/tricho-entrypoint.sh
