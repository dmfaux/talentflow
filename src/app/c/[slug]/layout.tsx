export default function CampaignLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .campaign-template {
              all: initial;
              display: block;
              font-family: sans-serif;
              line-height: 1.6;
              color: #1a1a1a;
              -webkit-font-smoothing: antialiased;
            }
            .campaign-template * {
              box-sizing: border-box;
            }
            .campaign-template img {
              max-width: 100%;
              height: auto;
            }
          `,
        }}
      />
      {children}
    </>
  );
}
