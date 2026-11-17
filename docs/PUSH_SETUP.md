# Web Push 운영 설정

2026-11-17 기준 `pbp-push v1`, `push_deliveries`, 신규 메시지 트리거는 프로젝트 `yftkqcqewashjqynltig`에 적용되어 있습니다. `PUSH_SETUP.sql`을 다시 실행하지 마세요. 이 파일은 적용한 SQL의 기록입니다.

실제 발송은 아직 활성화되지 않았습니다. Vault의 `pbp_push_hook_secret`이 없음을 확인했습니다. Edge Function 환경변수는 읽을 수 있는 연결 도구가 없어 설정 여부를 확인하지 못했습니다.

## 한 번만 수행할 설정

1. 프로젝트 폴더에서 `node scripts/generate-push-secrets.cjs`를 직접 실행합니다. 출력은 비밀값이 포함되므로 저장소·채팅·스크린샷에 공유하지 않습니다. 이미 운영 VAPID 키가 있으면 새 키를 만들지 말고 기존 키를 사용합니다.
2. Supabase Dashboard → 해당 PBP 프로젝트 → Edge Functions → Secrets에서 다음 값을 등록합니다.
   - `VAPID_PUBLIC_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT` (기본값은 공개 PBP 사이트 URL이며 실제 연락 가능한 mailto 주소도 가능)
   - `PBP_PUSH_HOOK_SECRET`
3. Supabase Vault에서 이름 `pbp_push_hook_secret`으로 비밀값을 등록합니다. 값은 2번의 `PBP_PUSH_HOOK_SECRET`과 정확히 같아야 합니다. SQL 쿼리 기록에 비밀값을 남기지 않도록 Dashboard의 Vault 입력 화면을 사용하세요.
4. 앱을 빌드하고 사용자가 직접 GitHub Pages에 배포합니다. 현재 작업에서는 커밋·푸시·Pages 배포를 하지 않았습니다.
5. 앱 설정에서 사용자가 직접 **이 기기 알림 켜기**를 누르고 권한을 허용합니다. 기기마다 별도로 구독해야 합니다.
6. 서로 다른 두 계정으로 같은 RP방에 참여합니다. 한 계정에서 실제 신규 메시지를 작성하고, 다른 계정의 PC/iPhone에서 수신·클릭 이동을 확인합니다.

클라이언트는 `pbp-push`의 인증된 `config` 응답으로 공개키만 받습니다. VAPID 비밀키와 service_role 키는 프론트엔드 `.env` 또는 CRA `REACT_APP_` 변수에 넣지 마세요.

## 동작

- DB INSERT 트리거가 발송합니다. 수신자의 앱이 종료되어 있어도 클라이언트 Realtime 연결에 의존하지 않습니다.
- 본인 메시지, 알림 해제 계정, 비활성·만료 계정은 발송하지 않습니다.
- 한 사용자에게 여러 기기 구독을 허용합니다. 로그아웃 시 해당 브라우저의 구독을 제거합니다. 알림 끄기는 계정 알림 설정을 끄면서 현재 기기 구독을 제거합니다.
- 404/410 구독은 서버에서 제거합니다. 메시지·구독 쌍의 중복 전송은 `push_deliveries`로 막습니다.
- 푸시는 RP 본문·인장·방 이름을 잠금 화면에 노출하지 않는 일반 문구를 사용합니다.
- 현재 보이는 방의 인앱 배너는 생략하고 다른 방 신규 메시지만 배너를 표시합니다. 표준 Web Push 알림은 별도로 전달됩니다.
- iOS는 Safari → 공유 → 홈 화면에 추가 → 설치한 앱 실행 → 알림 켜기 순서입니다. 일반 Safari 탭은 계속 웹앱으로 사용할 수 있습니다.
- 키/권한 미설정 시 **인앱 알림만 켜기**를 사용할 수 있습니다. 인앱 알림은 앱을 열어 둔 동안에만 수신합니다.
- 알림 클릭은 `/pbp_1.0/#room=ID`를 사용합니다. 로그인 후에도 링크를 보존하며, 비공개방의 멤버십을 확인합니다.

## 운영 확인과 제한

- 첫 수신 실패 시 Edge Function 로그와 `net._http_response`의 HTTP 상태를 확인하세요. 비밀값이 두 위치에서 일치하는지 확인합니다.
- 5xx/일시적인 네트워크 장애에는 자동 재시도 큐가 없습니다. 해당 실패의 중복 방지 기록은 제거되므로 동일 메시지에 대한 서버 훅 재시도는 가능합니다. 자동 재시도 정책은 후속 운영 결정 대상입니다.
- VAPID 키를 교체하면 각 기기에서 알림을 다시 켜야 합니다.
- 브라우저 저장 공간이나 사이트 데이터를 지우면 재구독이 필요합니다.
- 이 단계에서는 실제 푸시 발송, Windows Chrome/Whale OS 알림, iPhone 잠금 화면 수신을 검증하지 못했습니다.

참고: [Apple WebKit의 iOS 16.4 Web Push 안내](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks), [web-push](https://github.com/web-push-libs/web-push).
