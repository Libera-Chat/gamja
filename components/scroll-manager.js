import { html, Component } from "/lib/index.js";

var store = new Map();

export default class ScrollManager extends Component {
	stickToBottom = false;

	constructor(props) {
		super(props);

		this.handleScroll = this.handleScroll.bind(this);
	}

	isAtBottom() {
		var target = this.props.target.current;
		return target.scrollTop >= target.scrollHeight - target.offsetHeight;
	}

	scroll(pos) {
		var target = this.props.target.current;
		if (pos.bottom) {
			pos.y = target.scrollHeight - target.offsetHeight;
		}
		target.scrollTop = pos.y;
	}

	saveScrollPosition() {
		var target = this.props.target.current;
		store.set(this.props.scrollKey, {
			y: target.scrollTop,
			bottom: this.isAtBottom(),
		});
	}

	restoreScrollPosition() {
		var target = this.props.target.current;
		var pos = store.get(this.props.scrollKey);
		if (!pos) {
			pos = { bottom: true };
		}
		this.scroll(pos);
		this.stickToBottom = pos.bottom;
	}

	handleScroll() {
		this.stickToBottom = this.isAtBottom();
	}

	componentDidMount() {
		this.restoreScrollPosition();
		this.props.target.current.addEventListener("scroll", this.handleScroll);
	}

	componentWillReceiveProps(nextProps) {
		if (this.props.scrollKey !== nextProps.scrollKey) {
			this.saveScrollPosition();
		}
	}

	componentDidUpdate(prevProps) {
		if (this.props.scrollKey !== prevProps.scrollKey) {
			this.restoreScrollPosition();
		} else if (this.stickToBottom) {
			this.scroll({ bottom: true });
		}
	}

	componentWillUnmount() {
		this.props.target.current.removeEventListener("scroll", this.handleScroll);
		this.saveScrollPosition();
	}

	render() {
		return this.props.children;
	}
}
