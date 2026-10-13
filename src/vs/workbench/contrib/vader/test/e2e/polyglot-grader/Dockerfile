# Grader image for the Aider polyglot exercises: same toolchains as Aider's benchmark/Dockerfile, without the aider package itself.
FROM buildpack-deps:jammy
RUN apt-get update && apt-get install -y software-properties-common cmake libboost-all-dev \
    && add-apt-repository ppa:deadsnakes/ppa && apt-get update \
    && apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip ca-certificates-java openjdk-21-jdk libtbb-dev \
    && rm -rf /var/lib/apt/lists/*
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && python3.11 -m pip install --no-cache-dir pytest
RUN curl -L "https://golang.org/dl/go1.21.5.linux-amd64.tar.gz" -o go.tar.gz && tar -C /usr/local -xzf go.tar.gz && rm go.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"
ADD https://sh.rustup.rs /tmp/rustup.sh
RUN chmod +x /tmp/rustup.sh && /tmp/rustup.sh -y && rm /tmp/rustup.sh
ENV PATH="/root/.cargo/bin:${PATH}"
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /npm-install && cd /npm-install && npm init -y \
    && npm install jest@29.7.0 @babel/core@7.25.2 @exercism/babel-preset-javascript@0.2.1 @exercism/eslint-config-javascript@0.6.0 \
       @types/jest@29.5.12 @types/node@20.12.12 babel-jest@29.6.4 core-js@3.37.1 eslint@8.49.0
COPY npm-test.sh cpp-test.sh /grader/
RUN chmod +x /grader/*.sh && sed -i 's/\r$//' /grader/*.sh
