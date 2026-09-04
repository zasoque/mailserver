# Zasoque Mail Server

`zasoque.org`를 위한 자체 호스팅 메일 서버 및 관리 시스템입니다.

macOS에서 Postfix와 Dovecot을 기반으로 메일 송수신 환경을 구성하고,
웹 기반 Mail Admin, Roundcube Webmail, DKIM 서명 및 발신 주소 소유권 검증을
하나의 운영 환경으로 통합합니다.

현재 `v1.0`은 실제 운영 환경에서 메일 송수신과 발신 인증을 검증한 안정 버전입니다.

## Features

### Mail Server

- SMTP 수신 — Postfix `:25`
- SMTP Submission — Postfix `:587`
- IMAPS — Dovecot `:993`
- SMTP AUTH
- STARTTLS / TLS
- Maildir 기반 mailbox
- Virtual mailbox account
- Virtual Alias

### Authentication

발신 메일에 대해 다음 인증 체계를 사용합니다.

- SPF
- DKIM
- DMARC

DKIM 메일은 별도의 signer를 거쳐 Postfix로 재주입됩니다.

```text
Mail Client
    │
    │ SMTP AUTH / STARTTLS
    ▼
Postfix :587
    │
    │ Sender Authorization
    ▼
DKIM Signer :10027
    │
    ▼
Postfix Reinjection :10028
    │
    ▼
Internet
```

### Sender Authorization

SMTP 인증 사용자가 자신이 소유하지 않은 주소를 발신 주소로 사용하는 것을
서버 측에서 차단합니다.

두 계층으로 검증합니다.

```text
SMTP AUTH
    │
    ├── MAIL FROM
    │       │
    │       ▼
    │   Postfix
    │   smtpd_sender_login_maps
    │
    └── RFC 5322 From:
            │
            ▼
        senderauth Milter
        127.0.0.1:10029
```

Envelope sender는 Postfix의

```text
smtpd_sender_login_maps
reject_authenticated_sender_login_mismatch
```

로 검증합니다.

사용자가 실제로 보게 되는 RFC 5322 `From:`은 별도의 Go Milter가 검증합니다.

따라서 다음과 같은 발신은 거부됩니다.

```text
AUTH:
alice@zasoque.org

MAIL FROM:
alice@zasoque.org

From:
admin@zasoque.org
```

단, `admin@zasoque.org`가 Alice가 소유한 Alias라면 정상적으로 허용됩니다.

`MAIL FROM`과 `From:`이 같아야 하는 것이 아니라 **두 주소 모두 인증된 계정의
소유인지**를 검사합니다.

### Alias Sender

Alias를 단순한 수신 전달 주소뿐 아니라 발신 Identity로 사용할 수 있습니다.

예:

```text
Account
alice@zasoque.org

Aliases
admin@zasoque.org
hello@zasoque.org
```

Alice는 다음 주소를 모두 발신 주소로 사용할 수 있습니다.

```text
alice@zasoque.org
admin@zasoque.org
hello@zasoque.org
```

다른 account가 소유한 Alias 또는 존재하지 않는 주소는 사용할 수 없습니다.

Alias ownership은 Mail Admin의 Alias 설정으로부터 자동으로 sender map에
반영됩니다.

## Mail Admin

웹 기반 관리 인터페이스를 제공합니다.

```text
https://admin.mail.zasoque.org
```

주요 기능:

- Mail account 목록
- Maildir 사용량 확인
- Account 생성
- 비밀번호 변경
- Account 삭제
- 삭제 mailbox 보관 및 복원
- Protected account
- Alias 생성 / 수정 / 삭제
- Sender ownership 자동 동기화
- 관리자 인증

웹 애플리케이션에는 root 권한을 부여하지 않습니다.

```text
Browser
   │
   │ HTTPS
   ▼
Caddy
   │
   ▼
Mail Admin :8788
   │
   │ localhost
   ▼
Privileged Helper :8787
   │
   ▼
Dovecot users
Maildir
Postfix maps
```

권한이 필요한 시스템 변경은 localhost 전용 privileged helper가 담당합니다.

## Webmail

Roundcube를 통해 웹에서도 메일을 사용할 수 있습니다.

```text
https://webmail.zasoque.org
```

메일 수신:

```text
Roundcube
    │
    ▼
IMAPS :993
    │
    ▼
Dovecot
    │
    ▼
Maildir
```

메일 발신:

```text
Roundcube
    │
    ▼
Submission :587
    │
    ▼
Sender Authorization
    │
    ▼
DKIM
    │
    ▼
Internet
```

Roundcube에는 실제 mailbox account로 로그인합니다.

Alias는 별도의 mailbox account가 아니라 해당 account의 **Identity**로
등록하여 발신할 수 있습니다.

## Architecture

주요 구성 요소는 다음과 같습니다.

| Component          | Role                             |
| ------------------ | -------------------------------- |
| Postfix            | SMTP / Submission / mail routing |
| Dovecot            | IMAPS / authentication / Maildir |
| Zasoque Mail Admin | Account & Alias administration   |
| Mail Admin Helper  | Privileged system operations     |
| senderauth         | RFC 5322 From ownership Milter   |
| DKIM Signer        | Outbound DKIM signing            |
| Roundcube          | Webmail                          |
| Caddy              | HTTPS reverse proxy              |
| launchd            | Service lifecycle                |

### Ports

|  Port | Service                  | Exposure  |
| ----: | ------------------------ | --------- |
|    25 | SMTP                     | Public    |
|   443 | HTTPS                    | Public    |
|   587 | SMTP Submission          | Public    |
|   993 | IMAPS                    | Public    |
|  8787 | Mail Admin Helper        | localhost |
|  8788 | Mail Admin Web           | localhost |
|  9000 | PHP-FPM / Roundcube      | localhost |
| 10027 | DKIM signer              | localhost |
| 10028 | Postfix DKIM reinjection | localhost |
| 10029 | senderauth Milter        | localhost |

`8787`, `8788`, `9000`, `10027`, `10028`, `10029`는 외부에 직접 공개하지
않습니다.

## Sender Ownership Map

발신 주소 소유권의 canonical source는 다음 파일입니다.

```text
/usr/local/var/zasoque-mailadmin/postfix/sender_login
```

형식:

```text
<sender-address> <authenticated-account>
```

예:

```text
alice@zasoque.org alice@zasoque.org
hello@zasoque.org alice@zasoque.org
admin@zasoque.org bob@zasoque.org
```

Postfix와 senderauth가 동일한 ownership model을 사용합니다.

## Development

Requirements:

- macOS
- Bun
- Go

의존성 설치:

```bash
bun install --frozen-lockfile
```

개발 검증:

```bash
bun run check
bun test
bun run lint
bun run build
```

Senderauth:

```bash
bun run build:senderauth

cd senderauth
go test ./...
go vet ./...
```

## Production Build

```bash
bun install --frozen-lockfile

bun run check
bun test
bun run lint

bun run build
bun run build:senderauth
```

Privileged helper staging:

```bash
sudo deployment/stage-helper.sh "$(command -v bun)"
```

Sender map rebuild:

```bash
sudo deployment/rebuild-sender-login-map.sh
```

Senderauth staging:

```bash
sudo deployment/stage-senderauth.sh \
  "$PWD/senderauth/build/senderauth"

sudo deployment/verify-senderauth-deployment.sh
```

실제 production 설정을 변경하기 전에는 각 deployment script와
`deployment/README.md`를 확인하십시오.

## Security Model

이 프로젝트는 다음 원칙을 사용합니다.

**Least privilege**

웹 애플리케이션 자체는 일반 사용자 권한으로 실행하고, 시스템 파일을
변경해야 하는 작업만 별도의 privileged helper가 수행합니다.

**Loopback-only internal services**

관리 helper, senderauth, DKIM signer 및 reinjection service 등 내부
서비스는 외부 네트워크에 직접 노출하지 않습니다.

**Fail closed sender authorization**

sender ownership 정보를 읽을 수 없거나 Milter가 정상적으로 동작하지
않는 경우 발신 authorization을 우회하지 않습니다.

**Atomic map updates**

Postfix에서 사용하는 동적 map은 가능한 경우 temporary file + `fsync` +
atomic rename 방식으로 갱신하며 실패 시 rollback합니다.

**No secrets in repository**

다음 정보는 이 repository에 포함하지 않습니다.

- Mailbox passwords
- Administrator passwords
- Password hashes used in production
- Session secrets
- DKIM private keys
- TLS private keys
- Production environment files

Production secret은 별도의 제한된 파일로 관리합니다.

## Verified Production Behavior

`v1.0`은 실제 운영 환경에서 다음 항목을 검증했습니다.

| Test                             | Result     |
| -------------------------------- | ---------- |
| Account sender                   | PASS       |
| Owned Alias sender               | PASS       |
| Different owned MAIL FROM / From | PASS       |
| Unowned `From:`                  | 550 REJECT |
| External-domain `From:`          | 550 REJECT |
| Duplicate `From:`                | 550 REJECT |
| Postfix ↔ senderauth Milter      | PASS       |
| SASL identity Milter macro       | PASS       |
| Port 25 inbound mail             | PASS       |
| Roundcube → external mail        | PASS       |
| SPF                              | PASS       |
| DKIM                             | PASS       |
| DMARC                            | PASS       |

## Deployment

Production services are managed using macOS `launchd`.

주요 service:

```text
org.zasoque.postfix-start
org.zasoque.dovecot
org.zasoque.dkimsigner
org.zasoque.mailadmin.helper
org.zasoque.mailadmin.web
org.zasoque.senderauth
```

실제 설치, migration, rollback 및 장애 복구 절차는 별도의 재구축·마이그레이션
지침서를 사용합니다.

## Repository Safety

Public repository에 push하기 전에 secret scan을 권장합니다.

```bash
gitleaks git . --redact
```

Private key 파일도 확인할 수 있습니다.

```bash
git ls-files | grep -Ei '\.(pem|key|p12|pfx)$'
```

`v1.0` 공개 전 repository history 전체에 대해 Gitleaks 검사를 수행했으며,
탐지된 secret 없이 공개했습니다.

## License

현재 별도의 라이선스를 지정하지 않았습니다.

라이선스가 추가되기 전까지 이 repository의 공개 여부와 소프트웨어 사용
허가는 별개의 사항입니다.
