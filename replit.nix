{pkgs}: {
  deps = [
    pkgs.libev
    pkgs.ffmpeg
    pkgs.postgresql
    pkgs.openssl
  ];
}
