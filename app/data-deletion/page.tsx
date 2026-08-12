import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Eliminación de datos | SVC AI Secretary",
  description: "Instrucciones para solicitar la eliminación de datos en SVC AI Secretary.",
}

export default function DataDeletionPage() {
  return (
    <main className="h-full overflow-y-auto bg-background px-5 py-10 sm:px-8">
      <article className="mx-auto w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl shadow-black/20 sm:p-10">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-primary">SVC AI Secretary</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Eliminación de datos</h1>
        <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
          Podés solicitar la eliminación de los datos asociados a tu interacción con SVC AI Secretary.
        </p>

        <div className="mt-8 space-y-7 text-[15px] leading-7 text-slate-300">
          <section>
            <h2 className="text-lg font-semibold text-foreground">Cómo solicitarla</h2>
            <p className="mt-2">
              Enviá un mensaje desde el mismo número de WhatsApp con el que interactuaste e indicá claramente que querés eliminar tus datos, por ejemplo: “Eliminar mis datos”.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Qué información se identifica</h2>
            <p className="mt-2">
              La solicitud se vincula al número de teléfono de WhatsApp utilizado en la conversación y a los datos asociados a esa interacción.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground">Procesamiento de la solicitud</h2>
            <p className="mt-2">
              Una vez recibida, la solicitud se revisará y se eliminarán los datos aplicables, salvo aquellos que deban conservarse por razones de seguridad, prevención de fraude o cumplimiento de obligaciones legales.
            </p>
          </section>
        </div>
      </article>
    </main>
  )
}
