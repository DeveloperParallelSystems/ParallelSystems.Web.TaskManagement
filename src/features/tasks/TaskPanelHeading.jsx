export default function TaskPanelHeading({ id, icon: Icon, title, children }) {
    return (
        <div className="task-panel-heading">
            <span className="task-panel-icon" aria-hidden="true"><Icon size={21} /></span>
            <div>
                <h2 id={id}>{title}</h2>
                {children && <p>{children}</p>}
            </div>
        </div>
    );
}
